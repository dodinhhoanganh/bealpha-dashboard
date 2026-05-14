require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const mm = require("music-metadata");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const util = require("util");
const execFile = util.promisify(require("child_process").execFile);
const { Pool } = require("pg");
const Redis = require("ioredis");
const AdmZip = require("adm-zip");
// const { checkCopyright } = require("./copyright-check");

// Redis client for rate limiting and concurrency counters
const redis = new Redis(
  process.env.REDIS_URL || process.env.REDIS_URI || "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: null, // Prevent MaxRetriesPerRequestError crashes
    retryStrategy(times) {
      if (times > 10) return null; // Stop retrying after 10 attempts
      return Math.min(times * 2000, 30000); // Exponential backoff, max 30s
    },
    lazyConnect: true, // Don't block startup if Redis is unavailable
  },
);

// Handle Redis connection events to avoid unhandled exceptions
redis.on("error", (err) => {
  console.error("Redis error:", err && err.message ? err.message : err);
});
redis.on("connect", () => {
  console.log("Redis: connected");
});
redis.on("ready", () => {
  console.log("Redis: ready");
});
redis.on("reconnecting", (delay) => {
  console.warn(`Redis: reconnecting in ${delay}ms`);
});
redis.on("end", () => {
  console.warn("Redis: connection closed");
});

// ==========================================
// BACKGROUND JOBS (BullMQ)
// ==========================================
const { Queue, Worker } = require("bullmq");

const mediaQueue = new Queue("media-processing", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100, // Keep last 100 failed jobs for debugging
  },
});

const mediaWorker = new Worker("media-processing", async (job) => {
  console.log(`[Job ${job.id}] Started processing: ${job.name}`);
  const { inputPath, outputDir, peaksPath, previewPath } = job.data;

  try {
    if (job.name === "process-audio") {
      // 1. Generate HLS
      await generateHLS(inputPath, path.join(outputDir, "hls"));
      // 2. Generate waveform peaks
      await generatePeaks(inputPath, peaksPath);
      // 3. Generate preview snippet
      await generatePreviewSnippet(inputPath, previewPath);
    } else if (job.name === "process-video") {
      // 1. Generate Video HLS
      await generateVideoHLS(inputPath, path.join(outputDir, "hls"));
      // 2. Generate video preview snippet
      await generateVideoPreviewSnippet(inputPath, previewPath);
    }
    console.log(`[Job ${job.id}] Completed successfully.`);
  } catch (err) {
    console.error(`[Job ${job.id}] Failed:`, err);
    throw err;
  }
}, {
  connection: redis,
  concurrency: 2, // Process up to 2 heavy media jobs concurrently
});

mediaWorker.on("failed", (job, err) => {
  console.error(`[BullMQ] Job ${job.id} failed:`, err.message);
});

const app = express();

// Start S3 Receipt Polling
const { startS3Polling } = require("./s3-receipt-worker");
startS3Polling();

// Security audit fix H2: Removed duplicate CORS config block (was dead code).
// CORS is now configured once below after ALLOWED_ORIGINS definition.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Block direct access to HLS/preview content from static route — must go through /stream/audio/*
app.use("/uploads", (req, res, next) => {
  const reqPath = decodeURIComponent(req.path).toLowerCase();
  // Block HLS segments, playlists, preview snippets, and peak data
  if (
    reqPath.endsWith(".m3u8") ||
    reqPath.endsWith(".ts") ||
    reqPath.includes("/hls/") ||
    reqPath.endsWith("peaks.json")
  ) {
    return res.status(403).json({
      error: "ERROR_DIRECT_ACCESS_TO_STREAMING_CONTENT_IS_FORBID",
    });
  }
  next();
});
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/storage", express.static(path.join(__dirname, "storage")));
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ========== Redis-backed rate limiter and concurrency guards ==========
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "120");
const MAX_CONCURRENT_UPLOADS_PER_IP = parseInt(
  process.env.MAX_CONCURRENT_UPLOADS_PER_IP || "3",
);
const MAX_CONCURRENT_STREAMS_GLOBAL = parseInt(
  process.env.MAX_CONCURRENT_STREAMS_GLOBAL || "60",
);
const MAX_CONCURRENT_STREAMS_PER_IP = parseInt(
  process.env.MAX_CONCURRENT_STREAMS_PER_IP || "8",
);
const STREAM_TTL_SEC = parseInt(process.env.STREAM_TTL_SEC || "3600");

async function rateLimitMiddleware(req, res, next) {
  try {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const key = `rl:${ip}`;
    const count = await safeIncr(key);
    if (count === 1) await safePexpire(key, RATE_LIMIT_WINDOW_MS);
    if (count > RATE_LIMIT_MAX) {
      let pttl = -1;
      if (redisAvailable) {
        try {
          pttl = await redis.pttl(key);
        } catch (e) {
          pttl = -1;
          redisAvailable = false;
        }
      }
      if (pttl < 0) pttl = RATE_LIMIT_WINDOW_MS;
      res.setHeader("Retry-After", Math.ceil(Math.max(pttl, 0) / 1000));
      return res.status(429).json({ error: "ERROR_TOO_MANY_REQUESTS" });
    }
  } catch (e) {
    console.error("Rate limiter error:", e.message);
    // If Redis fails, don't block traffic — fail open
  }
  next();
}

async function checkUploadConcurrency(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const key = `uploads:${ip}`;
  try {
    const cur = await safeIncr(key);
    if (cur === 1) await safeExpire(key, 60 * 60); // 1 hour TTL to avoid leaks
    if (cur > MAX_CONCURRENT_UPLOADS_PER_IP) {
      await safeDecr(key);
      return res.status(429).json({ error: "ERROR_TOO_MANY_CONCURRENT_UPLOADS" });
    }
  } catch (e) {
    console.error("Upload concurrency check error:", e.message);
    // If Redis fails, allow request but log
    return next();
  }

  res.on("finish", async () => {
    try {
      const val = await safeDecr(key);
      if (val <= 0) await safeDel(key);
    } catch (e) {
      /* ignore */
    }
  });

  next();
}

app.use((req, res, next) => rateLimitMiddleware(req, res, next));

// ── Security Headers ──────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

// ── Database Connection ──────────────────────────────────
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Lấy labelId từ releaseId trong database.
 * Track → Release → Label
 */
async function getLabelIdFromRelease(releaseId) {
  try {
    const result = await dbPool.query(
      "SELECT label_id FROM core.releases WHERE id = $1",
      [releaseId],
    );
    return result.rows[0]?.label_id || null;
  } catch (err) {
    console.error("[DB] getLabelIdFromRelease error:", err.message);
    return null;
  }
}

async function getLabelName(labelId) {
  try {
    const result = await dbPool.query(
      "SELECT name FROM core.labels WHERE id = $1",
      [labelId],
    );
    return result.rows[0]?.name || null;
  } catch (err) {
    console.error("[DB] getLabelName error:", err.message);
    return null;
  }
}

/**
 * Sanitize filename: giữ tên gốc nhưng loại bỏ ký tự nguy hiểm
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "";
  // Only take the last path segment if client sent a path
  const base = path.basename(name);
  let out = base
    .replace(/[<>:"|\\?*\x00-\x1f]/g, "_") // remove dangerous chars
    .replace(/\.\./g, "_") // prevent path traversal
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
  // Limit length
  if (out.length > 200) out = out.slice(0, 200);
  if (out === "" || out === "." || out === "..") {
    // fallback to uuid
    return crypto.randomUUID();
  }
  return out;
}

// Read the first `length` bytes of a file (used for magic header checks)
function readFileHeader(filePath, length = 12) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, "r", (err, fd) => {
      if (err) return reject(err);
      const buf = Buffer.alloc(length);
      fs.read(fd, buf, 0, length, 0, (err, bytesRead, buffer) => {
        try {
          fs.closeSync(fd);
        } catch (e) { }
        if (err) return reject(err);
        resolve(buffer.slice(0, bytesRead));
      });
    });
  });
}

function isPngHeader(buf) {
  if (!buf || buf.length < 8) return false;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buf.slice(0, 8).equals(sig);
}

function isJpegHeader(buf) {
  if (!buf || buf.length < 3) return false;
  // JPEG files start with 0xFF 0xD8 0xFF
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isWavHeader(buf) {
  if (!buf || buf.length < 12) return false;
  try {
    return (
      buf.slice(0, 4).toString() === "RIFF" &&
      buf.slice(8, 12).toString() === "WAVE"
    );
  } catch (e) {
    return false;
  }
}

function isFlacHeader(buf) {
  if (!buf || buf.length < 4) return false;
  try {
    return buf.slice(0, 4).toString() === "fLaC";
  } catch (e) {
    return false;
  }
}

function isMp4Header(buf) {
  if (!buf || buf.length < 8) return false;
  try { return buf.slice(4, 8).toString() === "ftyp"; } catch (e) { return false; }
}

function isMkvHeader(buf) {
  if (!buf || buf.length < 4) return false;
  const sig = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  return buf.slice(0, 4).equals(sig);
}

function isMovHeader(buf) {
  if (!buf || buf.length < 8) return false;
  try { return buf.slice(4, 8).toString() === "moov" || buf.slice(4, 8).toString() === "ftyp"; } catch (e) { return false; }
}

function isVideoHeader(buf) {
  return isMp4Header(buf) || isMkvHeader(buf) || isMovHeader(buf);
}

function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

// Validate a single filename segment (no traversal, only safe chars)
function validateFilenameSegment(seg) {
  if (!seg || typeof seg !== "string") return false;
  if (seg === "." || seg === "..") return false;
  // allow any character except slashes and null bytes (unicode and spaces are allowed)
  return /^[^\\/\0]+$/.test(seg);
}

function validatePathSegments(p) {
  if (!p || typeof p !== "string") return false;
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(validateFilenameSegment);
}

// --- Redis-safe wrapper + in-memory fallback ---
// --- Redis-safe wrapper + in-memory fallback ---
let redisAvailable = true;
redis.on("ready", () => {
  redisAvailable = true;
});
redis.on("end", () => {
  redisAvailable = false;
});
redis.on("error", () => {
  redisAvailable = false;
});

const _memCounters = new Map();
const _memTimers = new Map();

function _clearMemTimer(key) {
  const t = _memTimers.get(key);
  if (t) {
    clearTimeout(t);
    _memTimers.delete(key);
  }
}

async function safeIncr(key) {
  if (redisAvailable) {
    try {
      return await redis.incr(key);
    } catch (e) {
      console.warn(
        "Redis incr failed, falling back to memory:",
        e && e.message ? e.message : e,
      );
      redisAvailable = false;
    }
  }
  const cur = (_memCounters.get(key) || 0) + 1;
  _memCounters.set(key, cur);
  return cur;
}

async function safeDecr(key) {
  if (redisAvailable) {
    try {
      return await redis.decr(key);
    } catch (e) {
      console.warn(
        "Redis decr failed, falling back to memory:",
        e && e.message ? e.message : e,
      );
      redisAvailable = false;
    }
  }
  const cur = Math.max((_memCounters.get(key) || 0) - 1, 0);
  if (cur <= 0) {
    _memCounters.delete(key);
    _clearMemTimer(key);
    return 0;
  }
  _memCounters.set(key, cur);
  return cur;
}

async function safeGet(key) {
  if (redisAvailable) {
    try {
      return await redis.get(key);
    } catch (e) {
      console.warn(
        "Redis get failed, falling back to memory:",
        e && e.message ? e.message : e,
      );
      redisAvailable = false;
    }
  }
  const v = _memCounters.get(key);
  return typeof v === "number" ? String(v) : null;
}

async function safeExpire(key, seconds) {
  if (redisAvailable) {
    try {
      return await redis.expire(key, seconds);
    } catch (e) {
      console.warn(
        "Redis expire failed, falling back to memory:",
        e && e.message ? e.message : e,
      );
      redisAvailable = false;
    }
  }
  // set a timer to delete the key after seconds
  _clearMemTimer(key);
  const ms = Math.max(0, seconds * 1000);
  const t = setTimeout(() => {
    _memCounters.delete(key);
    _memTimers.delete(key);
  }, ms);
  _memTimers.set(key, t);
  return 1;
}

async function safePexpire(key, ms) {
  if (redisAvailable) {
    try {
      return await redis.pexpire(key, ms);
    } catch (e) {
      console.warn(
        "Redis pexpire failed, falling back to memory:",
        e && e.message ? e.message : e,
      );
      redisAvailable = false;
    }
  }
  _clearMemTimer(key);
  const t = setTimeout(() => {
    _memCounters.delete(key);
    _memTimers.delete(key);
  }, ms);
  _memTimers.set(key, t);
  return 1;
}

async function safeDel(key) {
  if (redisAvailable) {
    try {
      return await redis.del(key);
    } catch (e) {
      console.warn(
        "Redis del failed, falling back to memory:",
        e && e.message ? e.message : e,
      );
      redisAvailable = false;
    }
  }
  _memCounters.delete(key);
  _clearMemTimer(key);
  return 1;
}
// CORS — restrict to known origins
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.DASHBOARD_URL,
  process.env.CORS_ORIGIN,
].filter(Boolean);

// Dynamic check for LAN / ZeroTier / Tailscale IPs (e.g. 192.168.x.x, 10.x.x.x, 172.16.x.x, 26.x.x.x)
function isLocalOrLanOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) || // RFC 1918: 172.16-31.x.x only
      host.startsWith("26.") // VPNs like Radmin/Hamachi
    );
  } catch (e) {
    return false;
  }
}

// Security audit fix C3: Removed dangerous port-suffix wildcards (origin.endsWith(':3000'))
// that allowed ANY domain on port 3000/3001 to make authenticated cross-origin requests.
// Only explicit ALLOWED_ORIGINS and verified LAN origins are now permitted.
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server requests (no origin) and explicitly allowed origins
      if (
        !origin ||
        ALLOWED_ORIGINS.includes(origin) ||
        isLocalOrLanOrigin(origin)
      ) {
        cb(null, origin || true);
      } else {
        cb(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Upload-Token",
    ],
    exposedHeaders: ["Content-Length", "Content-Type", "Content-Range"],
  }),
);

// Add CORS headers for static files — restrict to known origins
app.use("/uploads", (req, res, next) => {
  const reqOrigin = req.headers.origin;
  if (
    reqOrigin &&
    (ALLOWED_ORIGINS.includes(reqOrigin) ||
      isLocalOrLanOrigin(reqOrigin) ||
      reqOrigin.endsWith(":3000") ||
      reqOrigin.endsWith(":3001") ||
      process.env.NODE_ENV === "development")
  ) {
    res.header("Access-Control-Allow-Origin", reqOrigin);
  }
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Range, Authorization, X-API-Key, X-Upload-Token",
  );
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

// ── API Key Authentication for upload/delete operations ──
// Supports two auth methods:
//   1. x-api-key header (server-to-server)
//   2. x-upload-token header (browser-direct, signed JWT from dashboard)
const UPLOAD_API_KEY = process.env.UPLOAD_API_KEY;

/**
 * Verify a signed upload token (JWT) using HMAC-SHA256.
 * Uses Node.js built-in crypto — zero external dependencies.
 * Token format: base64url(header).base64url(payload).base64url(signature)
 */
function verifyUploadToken(token) {
  if (!token || !UPLOAD_API_KEY) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Verify HMAC-SHA256 signature
    const signatureInput = parts[0] + "." + parts[1];
    const expectedSig = crypto
      .createHmac("sha256", UPLOAD_API_KEY)
      .update(signatureInput)
      .digest("base64url");

    // B1 fix: constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(expectedSig);
    const providedBuf = Buffer.from(parts[2]);
    if (
      sigBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, providedBuf)
    )
      return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    // Check purpose
    if (payload.purpose !== "upload") return null;

    return payload;
  } catch (e) {
    return null;
  }
}

function requireApiKey(req, res, next) {
  // Skip auth in development if no key is configured
  if (!UPLOAD_API_KEY && process.env.NODE_ENV !== "production") {
    return next();
  }
  if (!UPLOAD_API_KEY) {
    return res
      .status(503)
      .json({ error: "ERROR_UPLOAD_SERVER_NOT_CONFIGURED_UPLOAD_API_KEY" });
  }

  // Method 1: Direct API key (server-to-server)
  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided === UPLOAD_API_KEY) {
    return next();
  }

  // Method 2: Signed upload token (browser-direct)
  const uploadToken = req.headers["x-upload-token"];
  if (uploadToken) {
    const payload = verifyUploadToken(uploadToken);
    if (payload) {
      req.uploadUserId = payload.sub; // Attach userId for audit
      return next();
    }
  }

  return res
    .status(401)
    .json({
      error: "ERROR_UNAUTHORIZED_INVALID_OR_MISSING_API_KEY_UPLO",
    });
}

// Serve uploaded files statically
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type || "general";
    const safeLabel = sanitizeFilename(
      req.body.labelName || req.body.labelId || "Independent",
    );
    const safeArtist = sanitizeFilename(
      req.body.artistName || "Unknown Artist",
    );
    const safeRelease = sanitizeFilename(
      req.body.releaseTitle ||
      req.body.releaseId ||
      req.body.entityName ||
      "Unknown Release",
    );

    let folderParts = [];

    if (req.body.isTemp === "true") {
      folderParts = ["uploads", "temp", type, crypto.randomUUID()];
    } else if (type === "avatars") {
      const safeEntity = sanitizeFilename(
        req.body.entityName || req.body.entityId || "default",
      );
      folderParts = ["uploads", "avatars", safeEntity];
    } else if (type === "labels") {
      folderParts = ["uploads", safeLabel, "logo"];
    } else if (type === "artists") {
      folderParts = ["uploads", safeLabel, safeArtist, "avatar"];
    } else if (type === "covers") {
      folderParts = ["uploads", safeLabel, safeArtist, safeRelease, "artwork"];
    } else if (type === "video") {
      folderParts = ["uploads", safeLabel, safeArtist, safeRelease, "video"];
    } else if (type === "documents") {
      folderParts = [
        "uploads",
        safeLabel,
        safeArtist,
        safeRelease,
        "documents",
      ];
    } else if (type === "restore") {
      folderParts = ["uploads", "restore"];
    } else {
      const safeEntity = sanitizeFilename(
        req.body.entityName || req.body.entityId || "default",
      );
      folderParts = ["uploads", "general", safeEntity];
    }

    const uploadPath = path.join(__dirname, ...folderParts);

    // Xóa các file cũ trong thư mục nếu là avatar, label hoặc artist (chỉ giữ lại file mới)
    // B2 fix: only clean up if entityId looks like a valid UUID (prevents spoofed entityId cleanup)
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const entityId = req.body.entityId;
    if (
      ["avatars", "labels", "artists"].includes(type) &&
      entityId &&
      UUID_RE.test(entityId)
    ) {
      if (fs.existsSync(uploadPath)) {
        try {
          const files = fs.readdirSync(uploadPath);
          for (const f of files) {
            // Only delete regular files, not directories
            const fp = path.join(uploadPath, f);
            if (fs.statSync(fp).isFile()) {
              fs.unlinkSync(fp);
            }
          }
        } catch (e) {
          console.error("Failed to clean up old files in:", uploadPath, e);
        }
      }
    }

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Keep original filename, no UUIDs
    try {
      file.originalname = Buffer.from(file.originalname, "latin1").toString(
        "utf8",
      );
    } catch (e) { }
    const safeName = sanitizeFilename(file.originalname);
    cb(null, safeName);
  },
});

// Audio storage — giữ tên file gốc, lưu vào labelId/isrc/
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath;
    if (req.body.isTemp === "true") {
      uploadPath = path.join(
        __dirname,
        "uploads",
        "temp",
        "audio",
        crypto.randomUUID(),
      );
    } else {
      const safeLabel = sanitizeFilename(
        req.body.labelName || req.body.labelId || "Independent",
      );
      const safeArtist = sanitizeFilename(
        req.body.artistName || "Unknown Artist",
      );
      const safeReleaseId = sanitizeFilename(
        req.body.releaseTitle || req.body.releaseId || "standalone",
      );
      const trackTitle = req.body.trackTitle
        ? sanitizeFilename(req.body.trackTitle)
        : null;
      const safeTrack =
        trackTitle ||
        sanitizeFilename(file.originalname.split(".")[0]) ||
        "Unknown Track";
      const trackFolder = `${safeArtist} - ${safeTrack}`;

      uploadPath = path.join(
        __dirname,
        "uploads",
        "audio",
        safeLabel,
        safeReleaseId,
        trackFolder,
      );
    }

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Giữ nguyên tên file gốc (đã sanitize)
    try {
      file.originalname = Buffer.from(file.originalname, "latin1").toString(
        "utf8",
      );
    } catch (e) { }
    const safeName = sanitizeFilename(file.originalname);
    cb(null, safeName);
  },
});

// For audio we do post-upload magic-header validation (do NOT rely on extension/mimetype)
const uploadAudioOriginal = multer({
  storage: audioStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// File filter for images only (artwork: JPG/PNG)
// Note: image file type will be validated post-upload using magic header. Do NOT trust extension/mimetype.

// Audio type validation happens after writing to disk (magic header check)

// File filter for video files (Vevo spec - only check extension here)
const videoFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = [".mp4", ".mov"];
  if (!allowedExts.includes(ext)) {
    return cb(
      new Error("ERROR_VEVO_ONLY_MP4_OR_MOV"),
      false,
    );
  }
  cb(null, true);
};

// ══════════════════════════════════════════════════════════
// VEVO QC Validation — Official specs from https://support.vevo.com/hc/en-us/articles/360033310854
//
// HD Videos:  H.264/ProRes, 1920x1080, ≥23.98fps, 20mbps (min 7500kb/s), AAC stereo 44.1kHz 320kbps
// 4K/2K:     ProRes ONLY, 1440p/2160p, aspect 16:9|1.85:1|2:1|2.35:1|2.39:1|2.4:1,
//            fps 23.976|24|25|29.97|30|48|50|60, 30mbps(2K)/60mbps(4K), LPCM stereo 48kHz
// Vertical:  NO LONGER SUPPORTED — width must exceed height
// Length:    No limit (max file size 128GB on VEVO side, 40GB on our system)
// ══════════════════════════════════════════════════════════
async function validateVevoVideo(filePath) {
  try {
    const { stdout } = await execFile("ffprobe", [
      "-v", "error",
      "-show_entries",
      "stream=codec_name,codec_type,width,height,r_frame_rate,bit_rate,channels,sample_rate,field_order:format=duration",
      "-of", "json",
      filePath,
    ]);
    const probe = JSON.parse(stdout);
    const videoStream = probe.streams?.find((s) => s.codec_type === "video");
    const audioStream = probe.streams?.find((s) => s.codec_type === "audio");

    const errors = [];

    if (!videoStream) {
      errors.push("ERROR_VEVO_NO_VIDEO_STREAM");
      return errors;
    }

    const width = parseInt(videoStream?.width);
    const height = parseInt(videoStream?.height);

    // VEVO no longer supports vertical videos — width must exceed height
    if (height >= width) {
      errors.push("ERROR_VEVO_VERTICAL_NOT_SUPPORTED");
      return errors;
    }

    // All categories: must be de-interlaced
    const fieldOrder = videoStream.field_order;
    if (fieldOrder && fieldOrder !== "progressive" && fieldOrder !== "unknown") {
      errors.push("ERROR_VEVO_INTERLACED_VIDEO");
    }

    // Determine category by height
    const is4K = height >= 2160;
    const is2K = height >= 1440 && !is4K;
    const isHD = width === 1920 && height === 1080;

    // Parse frame rate once
    const fpsStr = videoStream?.r_frame_rate || "0/1";
    const [fpsNum, fpsDen] = fpsStr.split("/").map(Number);
    const fps = fpsDen ? fpsNum / fpsDen : 0;

    if (is4K || is2K) {
      // ── 4K/2K Category ──────────────────────────────
      // Codec: ProRes ONLY
      if (videoStream?.codec_name?.toLowerCase() !== "prores") {
        errors.push("ERROR_VEVO_4K2K_REQUIRES_PRORES");
      }

      // Aspect ratio validation
      const aspectRatio = width / height;
      const validAspects = [16/9, 1.85, 2.0, 2.35, 2.39, 2.4];
      if (!validAspects.some((r) => Math.abs(aspectRatio - r) < 0.05)) {
        errors.push("ERROR_VEVO_INVALID_ASPECT_RATIO");
      }

      // Frame rate: specific values only
      const validFps = [23.976, 24, 25, 29.97, 30, 48, 50, 60];
      if (!validFps.some((f) => Math.abs(fps - f) < 0.05)) {
        errors.push("ERROR_VEVO_INVALID_FRAME_RATE");
      }

      // Bit rate: 60mbps (4K) / 30mbps (2K)
      const videoBitrate = parseInt(videoStream?.bit_rate || 0);
      const minBitrate = is4K ? 60000000 : 30000000;
      if (videoBitrate > 0 && videoBitrate < minBitrate) {
        errors.push(`ERROR_VEVO_LOW_VIDEO_BITRATE:${minBitrate / 1000000}`);
      }

      // Audio for 4K/2K: LPCM, Stereo, 48kHz
      if (!audioStream) {
        errors.push("ERROR_VEVO_NO_AUDIO_STREAM");
      } else {
        const lpcmCodecs = ["pcm_s16le", "pcm_s24le", "pcm_s16be", "pcm_s24be", "pcm_s32le"];
        if (!lpcmCodecs.includes(audioStream?.codec_name?.toLowerCase())) {
          errors.push("ERROR_VEVO_4K2K_REQUIRES_LPCM_AUDIO");
        }
        if (parseInt(audioStream?.sample_rate || 0) < 48000) {
          errors.push("ERROR_VEVO_4K2K_SAMPLE_RATE_48KHZ");
        }
        if (parseInt(audioStream?.channels || 0) !== 2) {
          errors.push("ERROR_VEVO_NOT_STEREO");
        }
      }
    } else if (isHD) {
      // ── HD Category ─────────────────────────────────
      // Codec: H.264 or ProRes
      const validCodecs = ["h264", "prores"];
      if (!validCodecs.includes(videoStream?.codec_name?.toLowerCase())) {
        errors.push("ERROR_VEVO_INVALID_VIDEO_CODEC");
      }

      // Frame rate: >= 23.98
      if (isNaN(fps) || fps < 23.98) {
        errors.push("ERROR_VEVO_LOW_FRAME_RATE");
      }

      // Bit rate: 20mbps (minimum 7500 kb/s)
      const videoBitrate = parseInt(videoStream?.bit_rate || 0);
      if (videoBitrate > 0 && videoBitrate < 7500000) {
        errors.push("ERROR_VEVO_LOW_VIDEO_BITRATE:7.5");
      }

      // Audio for HD: AAC, Stereo, 44.1kHz, 320kbps CBR
      if (!audioStream) {
        errors.push("ERROR_VEVO_NO_AUDIO_STREAM");
      } else {
        if (audioStream?.codec_name?.toLowerCase() !== "aac") {
          errors.push("ERROR_VEVO_HD_REQUIRES_AAC_AUDIO");
        }
        if (parseInt(audioStream?.sample_rate || 0) < 44100) {
          errors.push("ERROR_VEVO_LOW_SAMPLE_RATE");
        }
        if (parseInt(audioStream?.channels || 0) !== 2) {
          errors.push("ERROR_VEVO_NOT_STEREO");
        }
        const audioBitrate = parseInt(audioStream?.bit_rate || 0);
        if (audioBitrate > 0 && audioBitrate < 320000) {
          errors.push("ERROR_VEVO_LOW_AUDIO_BITRATE");
        }
      }
    } else {
      // Not a recognized VEVO resolution
      errors.push("ERROR_VEVO_INVALID_RESOLUTION");
    }

    // FFmpeg Automated QC: cropdetect & blackdetect (slates/letterboxing)
    try {
      const { stderr: qcLog } = await execFile("ffmpeg", [
        "-i", filePath,
        "-vf", "cropdetect=24:16:0,blackdetect=d=0.5:pic_th=0.98",
        "-f", "null", "-",
        "-t", "60"
      ]);

      const cropRegex = /crop=([0-9]+):([0-9]+)/g;
      let match;
      let letterboxed = false;
      while ((match = cropRegex.exec(qcLog)) !== null) {
        if (parseInt(match[1]) < width - 10 || parseInt(match[2]) < height - 10) {
          letterboxed = true;
          break;
        }
      }
      if (letterboxed) errors.push("ERROR_VEVO_LETTERBOXING_DETECTED");
      if (qcLog.includes("black_start:")) errors.push("ERROR_VEVO_SLATES_DETECTED");
    } catch (e) {
      console.warn("FFmpeg QC check failed:", e.message);
    }

    return errors;
  } catch (e) {
    return ["ERROR_VEVO_PROBE_FAILED"];
  }
}

// File filter for documents
// B17 fix: require BOTH mimetype AND extension match to prevent spoofing
const documentFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/csv",
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = [".pdf", ".doc", ".docx", ".txt", ".csv", ".lrc"];

  // .lrc files may have text/plain mimetype — special case
  const mimeOk =
    allowedTypes.includes(file.mimetype) ||
    (ext === ".lrc" && file.mimetype === "application/octet-stream");
  const extOk = allowedExts.includes(ext);

  if (mimeOk && extOk) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Only document files are allowed (pdf, doc, docx, txt, csv, lrc)",
      ),
      false,
    );
  }
};

// Multer instances for different file types
// Do not rely on extension/mimetype checks here — validate by magic header after upload
// ==========================================
// AUDIO PROCESSING HELPERS (HLS & PEAKS)
// ==========================================

function generateHLS(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    ffmpeg(inputPath)
      .outputOptions([
        "-c:a aac",
        "-b:a 128k",
        "-vn",
        "-f hls",
        "-hls_time 10",
        "-hls_list_size 0",
        `-hls_segment_filename ${path.join(outputDir, "chunk_%03d.aac")}`,
      ])
      .output(path.join(outputDir, "playlist.m3u8"))
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

function generatePeaks(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const peaks = [];
    const stream = ffmpeg(inputPath)
      .outputOptions([
        "-ac 1",
        "-filter:a aresample=100",
        "-map 0:a",
        "-c:a pcm_s16le",
        "-f data",
      ])
      .pipe();

    stream.on("data", (chunk) => {
      // chunk is a Buffer of 16-bit signed little-endian integers
      // ensure we only read complete 16-bit chunks
      const len = chunk.length - (chunk.length % 2);
      for (let i = 0; i < len; i += 2) {
        const val = chunk.readInt16LE(i);
        peaks.push(Number((val / 32768).toFixed(4))); // normalize to [-1, 1] and keep 4 decimals for smaller JSON
      }
    });
    stream.on("end", () => {
      fs.writeFileSync(outputPath, JSON.stringify(peaks));
      resolve();
    });
    stream.on("error", reject);
  });
}

/**
 * Generate a preview snippet (30s or custom range) as AAC for quick B2B preview.
 * Uses -ss before -i for fast seek (DDEX spec recommendation).
 * @param {string} inputPath - Source audio file
 * @param {string} outputPath - Destination .aac file
 * @param {number} startSec - Start time in seconds (default 0)
 * @param {number} durationSec - Duration in seconds (default 30)
 */
function generatePreviewSnippet(inputPath, outputPath, startSec = 0, durationSec = 30) {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    ffmpeg()
      .input(inputPath)
      .inputOptions([`-ss ${startSec}`])
      .outputOptions([
        `-t ${durationSec}`,
        "-c:a aac",
        "-b:a 128k",
        "-vn",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

function generateVideoHLS(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 23",
        "-c:a aac",
        "-b:a 128k",
        "-f hls",
        "-hls_time 10",
        "-hls_list_size 0",
        `-hls_segment_filename ${path.join(outputDir, "chunk_%03d.ts")}`,
      ])
      .output(path.join(outputDir, "playlist.m3u8"))
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

function generateVideoPreviewSnippet(inputPath, outputPath, startSec = 0, durationSec = 30) {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    ffmpeg()
      .input(inputPath)
      .inputOptions([`-ss ${startSec}`])
      .outputOptions([
        `-t ${durationSec}`,
        "-c:v libx264",
        "-preset veryfast",
        "-crf 28",
        "-c:a aac",
        "-b:a 128k",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for images
});

const uploadAudio = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for audio
});

const uploadVideo = multer({
  storage,
  fileFilter: videoFilter,
  limits: { fileSize: 40 * 1024 * 1024 * 1024 }, // 40GB max for video (VEVO allows up to 128GB)
});

const uploadDocument = multer({
  storage,
  fileFilter: documentFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for documents
});

// Generic upload (any file type) with reasonable limit
const uploadGeneric = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// Helper to get upload middleware based on type
const getUploadMiddleware = (type) => {
  switch (type) {
    case "avatars":
    case "labels":
    case "artists":
    case "covers":
      return uploadImage;
    case "audio":
      return uploadAudio;
    case "video":
      return uploadVideo;
    case "documents":
      return uploadDocument;
    default:
      return uploadGeneric;
  }
};

// ══════════════════════════════════════════════════════════
// AUDIO UPLOAD — Lưu theo cấu trúc: uploads/{Label}/{Artist}/{ReleaseId}/audio/{Artist - Track}/{filename}
// ══════════════════════════════════════════════════════════
app.post(
  "/upload/audio",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadAudioOriginal.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) {
        return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });
      }

      const releaseId = req.body.releaseId;
      const isrc = req.body.isrc;

      // Lấy labelId từ database nếu có releaseId
      let labelId = req.body.labelId || null;
      if (!labelId && releaseId) {
        labelId = await getLabelIdFromRelease(releaseId);
      }

      let labelName = req.body.labelName
        ? sanitizeFilename(req.body.labelName)
        : null;
      if (!labelName && labelId) {
        const dbLabelName = await getLabelName(labelId);
        if (dbLabelName) labelName = sanitizeFilename(dbLabelName);
      }

      const artistName = req.body.artistName
        ? sanitizeFilename(req.body.artistName)
        : null;
      const trackTitle = req.body.trackTitle
        ? sanitizeFilename(req.body.trackTitle)
        : null;

      const safeLabel = labelName || req.body.labelId || "Independent";
      const safeArtist = artistName || "Unknown Artist";
      const safeTrack =
        trackTitle ||
        sanitizeFilename(req.file.originalname.split(".")[0]) ||
        "Unknown Track";

      // Build intuitive path: uploads/audio/{Label}/{ReleaseId}/{Artist - Track}/
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");
      const trackFolder = `${safeArtist} - ${safeTrack}`;
      let folderParts = [
        "uploads",
        "audio",
        safeLabel,
        safeReleaseId,
        trackFolder,
      ];

      const destDir = req.body.isTemp === "true" ? req.file.destination : path.join(__dirname, ...folderParts);

      // Xóa file cũ của track này nếu có (vì thư mục này chỉ dành cho 1 track)
      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          const files = fs.readdirSync(destDir);
          for (const f of files) {
            const filePath = path.join(destDir, f);
            if (filePath !== req.file.path) fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error("Failed to clean up old audio files in:", destDir, e);
        }
      } else if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // File hiện đang ở uploads/audio/{original_filename}
      // Validate magic header (do not trust extension/mimetype)
      const currentPath = req.file.path;
      let header;
      try {
        header = await readFileHeader(currentPath, 12);
        const validWav = isWavHeader(header);
        const validFlac = isFlacHeader(header);
        if (!validWav && !validFlac) {
          // remove uploaded file
          try {
            fs.unlinkSync(currentPath);
          } catch { }
          return res
            .status(400)
            .json({
              error: "ERROR_UPLOADED_FILE_IS_NOT_A_VALID_WAV_OR_FLAC_MAG",
            });
        }
        // Determine canonical extension based on magic
        const canonicalExt = validWav ? ".wav" : ".flac";

        // Determinate original name and fix unicode mangling
        let originalName = req.file.originalname;
        try {
          const decoded = Buffer.from(originalName, "latin1").toString("utf8");
          if (!decoded.includes("")) {
            originalName = decoded;
          }
        } catch (e) { }

        // Di chuyển vào folder đích and ensure extension matches content
        const rawSafe = sanitizeFilename(originalName);
        const base = path.basename(rawSafe, path.extname(rawSafe));
        const finalName = base + canonicalExt;
        const destPath = path.join(destDir, finalName);

        // Nếu file trùng tên đã tồn tại, ghi đè
        try {
          fs.renameSync(currentPath, destPath);
        } catch (moveErr) {
          // Fallback: copy + delete nếu rename fail (cross-device)
          fs.copyFileSync(currentPath, destPath);
          try {
            fs.unlinkSync(currentPath);
          } catch { }
        }

        // Extract duration + validate bit depth and sample rate
        let duration = null;
        let bitsPerSample = null;
        let sampleRate = null;
        try {
          const metadata = await mm.parseFile(destPath);
          duration = metadata.format.duration;
          bitsPerSample = metadata.format.bitsPerSample;
          sampleRate = metadata.format.sampleRate;
        } catch (e) {
          console.error("Failed to extract audio metadata:", e);
        }

        if (duration === null || isNaN(duration)) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_CANNOT_READ_AUDIO_DURATION" });
        }

        if (duration < 30) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_AUDIO_TOO_SHORT_MIN_30_SECONDS" });
        }

        // Audio quality: must be >= 16-bit
        if (!bitsPerSample || bitsPerSample < 16) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_AUDIO_BIT_DEPTH_MIN_16BIT" });
        }

        // Audio quality: sample rate must be >= 44.1kHz
        if (!sampleRate || sampleRate < 44100) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_AUDIO_SAMPLE_RATE_MIN_44100HZ" });
        }

        // ==========================================
        // Copyright Check Removed
        // ==========================================
        let copyrightResult = {
          status: "unchecked",
          totalCopyrightedSeconds: 0,
          trackDuration: Math.round(duration),
          matches: [],
          reason: "Copyright check disabled",
        };

        // ==========================================
        // Build URL path FIRST so we can respond immediately
        // ==========================================
        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        // ==========================================
        // Dispatch Background Job to BullMQ
        // ==========================================
        await mediaQueue.add("process-audio", {
          inputPath: destPath,
          outputDir: destDir,
          peaksPath: path.join(destDir, "peaks.json"),
          previewPath: path.join(destDir, "preview.aac")
        });

        const response = {
          success: true,
          filename: finalName,
          originalName: originalName,
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          labelId: labelId || null,
          isrc: isrc || null,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"),
          duration: Math.round(duration),
          copyrightCheck: copyrightResult,
        };

        res.json(response);
      } catch (e) {
        try {
          fs.unlinkSync(currentPath);
        } catch { }
        console.error(
          "Audio upload processing error:",
          e && e.message ? e.message : e,
        );
        return res
          .status(500)
          .json({
            error: "ERROR_FAILED_TO_PROCESS_UPLOADED_AUDIO",
          });
      }
    });
  },
);



// ==========================================
// APPLE DIGITAL MASTERS UPLOAD ENDPOINT
// Strict ADM spec: 24-bit WAV/FLAC only,
// sample rate 44.1/48/88.2/96/176.4/192 kHz
// ==========================================
const ADM_VALID_SAMPLE_RATES = [44100, 48000, 88200, 96000, 176400, 192000];

app.post(
  "/upload/adm",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadAudioOriginal.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) {
        return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });
      }

      const releaseId = req.body.releaseId;
      const isrc = req.body.isrc;

      let labelId = req.body.labelId || null;
      if (!labelId && releaseId) {
        labelId = await getLabelIdFromRelease(releaseId);
      }

      let labelName = req.body.labelName
        ? sanitizeFilename(req.body.labelName)
        : null;
      if (!labelName && labelId) {
        const dbLabelName = await getLabelName(labelId);
        if (dbLabelName) labelName = sanitizeFilename(dbLabelName);
      }

      const artistName = req.body.artistName
        ? sanitizeFilename(req.body.artistName)
        : null;
      const trackTitle = req.body.trackTitle
        ? sanitizeFilename(req.body.trackTitle)
        : null;

      const safeLabel = labelName || req.body.labelId || "Independent";
      const safeArtist = artistName || "Unknown Artist";
      const safeTrack =
        trackTitle ||
        sanitizeFilename(req.file.originalname.split(".")[0]) ||
        "Unknown Track";

      const safeReleaseId = sanitizeFilename(releaseId || "standalone");
      const trackFolder = `${safeArtist} - ${safeTrack}`;
      let folderParts = [
        "uploads",
        "adm",
        safeLabel,
        safeReleaseId,
        trackFolder,
      ];

      const destDir = req.body.isTemp === "true" ? req.file.destination : path.join(__dirname, ...folderParts);

      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          const files = fs.readdirSync(destDir);
          for (const f of files) {
            const filePath = path.join(destDir, f);
            if (filePath !== req.file.path) fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error("Failed to clean up old ADM files in:", destDir, e);
        }
      } else if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const currentPath = req.file.path;
      let header;
      try {
        header = await readFileHeader(currentPath, 12);
        const validWav = isWavHeader(header);
        const validFlac = isFlacHeader(header);
        if (!validWav && !validFlac) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res
            .status(400)
            .json({
              error: "ERROR_ADM_ONLY_WAV_OR_FLAC",
              message: "Apple Digital Masters requires WAV or FLAC format only.",
            });
        }

        const canonicalExt = validWav ? ".wav" : ".flac";

        let originalName = req.file.originalname;
        try {
          const decoded = Buffer.from(originalName, "latin1").toString("utf8");
          if (!decoded.includes("\ufffd")) {
            originalName = decoded;
          }
        } catch (e) { }

        const rawSafe = sanitizeFilename(originalName);
        const base = path.basename(rawSafe, path.extname(rawSafe));
        const finalName = base + canonicalExt;
        const destPath = path.join(destDir, finalName);

        try {
          fs.renameSync(currentPath, destPath);
        } catch (moveErr) {
          fs.copyFileSync(currentPath, destPath);
          try { fs.unlinkSync(currentPath); } catch { }
        }

        // Extract metadata for ADM validation
        let duration = null;
        let bitsPerSample = null;
        let sampleRate = null;
        let channels = null;
        let codec = null;
        try {
          const metadata = await mm.parseFile(destPath);
          duration = metadata.format.duration;
          bitsPerSample = metadata.format.bitsPerSample;
          sampleRate = metadata.format.sampleRate;
          channels = metadata.format.numberOfChannels;
          codec = metadata.format.codec || (validWav ? "WAV" : "FLAC");
        } catch (e) {
          console.error("Failed to extract ADM audio metadata:", e);
        }

        if (duration === null || isNaN(duration)) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_CANNOT_READ_AUDIO_DURATION" });
        }

        if (duration < 30) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_AUDIO_TOO_SHORT_MIN_30_SECONDS" });
        }

        // ADM STRICT: Must be 24-bit (or 32-bit float)
        if (!bitsPerSample || (bitsPerSample !== 24 && bitsPerSample !== 32)) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_ADM_REQUIRES_24BIT",
            message: `Apple Digital Masters requires 24-bit audio. This file is ${bitsPerSample || "unknown"}-bit.`,
            bitDepth: bitsPerSample,
          });
        }

        // ADM STRICT: Sample rate must be one of the approved values
        if (!sampleRate || !ADM_VALID_SAMPLE_RATES.includes(sampleRate)) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_ADM_INVALID_SAMPLE_RATE",
            message: `Invalid sample rate ${sampleRate}Hz for Apple Digital Masters. Accepted: 44.1, 48, 88.2, 96, 176.4, 192 kHz.`,
            sampleRate: sampleRate,
          });
        }

        // Build URL
        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        const response = {
          success: true,
          filename: finalName,
          originalName: originalName,
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          labelId: labelId || null,
          isrc: isrc || null,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\\\/g, "/"),
          duration: Math.round(duration),
          bitDepth: bitsPerSample,
          sampleRate: sampleRate,
          channels: channels,
          codec: codec,
          admValidation: {
            is24bit: bitsPerSample >= 24,
            sampleRateValid: ADM_VALID_SAMPLE_RATES.includes(sampleRate),
            formatValid: true,
            status: "PASSED",
          },
        };

        res.json(response);
      } catch (e) {
        try { fs.unlinkSync(currentPath); } catch { }
        console.error(
          "ADM upload processing error:",
          e && e.message ? e.message : e,
        );
        return res
          .status(500)
          .json({
            error: "ERROR_FAILED_TO_PROCESS_ADM_UPLOAD",
          });
      }
    });
  },
);




// ==========================================
// MV (VIDEO) UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/video",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    // FIXED: Use uploadVideo instead of uploadAudioOriginal to allow 2GB files
    uploadVideo.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const releaseId = req.body.releaseId;
      const isrc = req.body.isrc;

      let labelId = req.body.labelId || null;
      if (!labelId && releaseId) labelId = await getLabelIdFromRelease(releaseId);

      let labelName = req.body.labelName ? sanitizeFilename(req.body.labelName) : null;
      if (!labelName && labelId) {
        const dbLabelName = await getLabelName(labelId);
        if (dbLabelName) labelName = sanitizeFilename(dbLabelName);
      }

      const artistName = req.body.artistName ? sanitizeFilename(req.body.artistName) : null;
      const trackTitle = req.body.trackTitle ? sanitizeFilename(req.body.trackTitle) : null;

      const safeLabel = labelName || req.body.labelId || "Independent";
      const safeArtist = artistName || "Unknown Artist";
      const safeTrack = trackTitle || sanitizeFilename(req.file.originalname.split(".")[0]) || "Unknown Track";
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");
      const trackFolder = `${safeArtist} - ${safeTrack}`;

      let folderParts = ["uploads", "video", safeLabel, safeReleaseId, trackFolder];
      const destDir = req.body.isTemp === "true" ? req.file.destination : path.join(__dirname, ...folderParts);

      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          fs.readdirSync(destDir).forEach(f => {
            const filePath = path.join(destDir, f);
            if (filePath !== req.file.path) fs.unlinkSync(filePath);
          });
        } catch (e) { }
      } else if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const currentPath = req.file.path;
      let header;
      try {
        header = await readFileHeader(currentPath, 12);
        if (!isVideoHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_UPLOADED_FILE_IS_NOT_A_VALID_MP4_MKV_MOV_MAG" });
        }

        const canonicalExt = ".mp4"; // Normalize to .mp4 wrapper for HLS compatibility ideally, but we keep original if possible
        let finalExt = path.extname(req.file.originalname).toLowerCase();
        if (![".mp4", ".mov", ".mkv"].includes(finalExt)) finalExt = ".mp4";

        let originalName = req.file.originalname;
        try {
          const decoded = Buffer.from(originalName, "latin1").toString("utf8");
          if (!decoded.includes("")) originalName = decoded;
        } catch (e) { }

        const rawSafe = sanitizeFilename(originalName);
        const base = path.basename(rawSafe, path.extname(rawSafe));
        const finalName = base + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.renameSync(currentPath, destPath); } catch (e) {
          fs.copyFileSync(currentPath, destPath);
          try { fs.unlinkSync(currentPath); } catch { }
        }

        // FIXED: Run VEVO QC validation
        const vevoErrors = await validateVevoVideo(destPath);
        if (vevoErrors && vevoErrors.length > 0) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_VEVO_QC_FAILED", details: vevoErrors });
        }

        let duration = 0;
        try {
          const metadata = await probeMedia(destPath);
          duration = metadata.format.duration;
        } catch (e) {
          console.error("Failed to extract video metadata:", e);
        }

        if (!duration || duration < 10) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({ error: "ERROR_VIDEO_TOO_SHORT_OR_UNREADABLE" });
        }

        let copyrightResult = {
          status: "unchecked",
          totalCopyrightedSeconds: 0,
          trackDuration: Math.round(duration),
          matches: [],
          reason: "Copyright check disabled",
        };

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        // ==========================================
        // Dispatch Background Job to BullMQ
        // ==========================================
        await mediaQueue.add("process-video", {
          inputPath: destPath,
          outputDir: destDir,
          previewPath: path.join(destDir, "preview.mp4")
        });

        res.json({
          success: true,
          filename: finalName,
          originalName: originalName,
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"),
          duration: Math.round(duration),
          copyrightCheck: copyrightResult,
        });

      } catch (e) {
        try { fs.unlinkSync(currentPath); } catch { }
        return res.status(500).json({ error: "ERROR_FAILED_TO_PROCESS_VIDEO" });
      }
    });
  }
);

// ==========================================
// PROCESS VISUAL LOOP (Strip audio, optionally trim)
// ==========================================
function processVisualLoop(inputPath, outputPath, isCanvas, duration) {
  return new Promise((resolve, reject) => {
    let outputOptions = ["-an"]; // Strip audio

    if (isCanvas && duration >= 8.0) {
      // Must re-encode to trim exactly
      outputOptions.push("-t", "7.9", "-c:v", "libx264", "-preset", "fast", "-crf", "23");
    } else {
      // Just copy video stream if no trimming is needed
      outputOptions.push("-c:v", "copy");
    }

    ffmpeg(inputPath)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

// ==========================================
// SPOTIFY CANVAS UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/canvas",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadAudioOriginal.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "canvas", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "canvas", crypto.randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const currentPath = req.file.path;
      try {
        const header = await readFileHeader(currentPath, 12);
        if (!isVideoHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_CANVAS_MUST_BE_A_VALID_MP4_MOV_FILE" });
        }

        const metadata = await probeMedia(currentPath);
        const duration = metadata.format.duration;
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');

        if (!videoStream) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_NO_VIDEO_STREAM_FOUND_IN_CANVAS_FILE" });
        }

        // Spotify strict limits: 3s to 8s (auto-trim fires at >=8.0s)
        if (duration < 3 || duration > 8.0) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_CANVAS_DURATION_INVALID" });
        }

        // Spotify minimum resolution: 720p height
        const w = videoStream.width;
        const h = videoStream.height;

        if (h < 720) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_CANVAS_HEIGHT_TOO_SMALL" });
        }

        // Spotify Aspect Ratio limit: 9:16 vertical
        const ratio = h > 0 ? (w / h) : 0;
        const targetRatio = 9 / 16;

        // Allow tiny tolerance (0.05)
        if (Math.abs(ratio - targetRatio) > 0.05) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_CANVAS_ASPECT_RATIO_INVALID" });
        }

        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".mp4";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        // Process Canvas: Strip audio, trim if needed
        await processVisualLoop(currentPath, destPath, true, duration);
        try { fs.unlinkSync(currentPath); } catch { } // Cleanup original

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"), // path relative to base url
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { /* ignore */ }
        }
        console.error("[Canvas] POST /upload/canvas error:", err.message || err);
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  });

// ══════════════════════════════════════════════════════════
// HLS STATUS POLLING ENDPOINT
// Returns the processing status of HLS transcoding for a given audio path
// ══════════════════════════════════════════════════════════

// ==========================================
// APPLE MUSIC MOTION UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/motion",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadAudioOriginal.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "motion", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "motion", require('crypto').randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const currentPath = req.file.path;
      try {
        const header = await readFileHeader(currentPath, 12);
        if (!isVideoHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_MOTION_MUST_BE_A_VALID_MP4_MOV_FILE" });
        }

        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".mp4";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"),
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { }
        }
        console.error("[Motion] POST /upload/motion error:", err.message || err);
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  },
);

// ==========================================
// TIDAL ARTWORK UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/tidal-artwork",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadImage.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const currentPath = req.file.path;

      // F-2: Validate image magic header (do not trust extension/mimetype)
      try {
        const header = await readFileHeader(currentPath, 12);
        if (!isPngHeader(header) && !isJpegHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_FILE_IS_NOT_A_VALID_PNG_OR_JPEG" });
        }
      } catch (e) {
        try { fs.unlinkSync(currentPath); } catch { }
        return res.status(400).json({ error: "ERROR_FILE_VALIDATION_FAILED" });
      }

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "tidal-artwork", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "tidal-artwork", require('crypto').randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      try {
        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".png";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"),
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { }
        }
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  },
);

// ==========================================
// AMAZON ARTWORK UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/amazon-artwork",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadImage.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const currentPath = req.file.path;

      // F-2: Validate image magic header
      try {
        const header = await readFileHeader(currentPath, 12);
        if (!isPngHeader(header) && !isJpegHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_FILE_IS_NOT_A_VALID_PNG_OR_JPEG" });
        }
      } catch (e) {
        try { fs.unlinkSync(currentPath); } catch { }
        return res.status(400).json({ error: "ERROR_FILE_VALIDATION_FAILED" });
      }

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "amazon-artwork", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "amazon-artwork", require('crypto').randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      try {
        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".png";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"),
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { }
        }
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  },
);

app.get("/hls/status/*", (req, res) => {
  const requestPathRaw = req.params[0] || "";
  if (!validatePathSegments(requestPathRaw)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  const statusFile = path.join(__dirname, "uploads", ...requestPathRaw.split(/[\\/]+/), "hls", ".status");
  const resolved = path.resolve(statusFile);
  const uploadsRoot = path.resolve(__dirname, "uploads");

  if (!resolved.startsWith(uploadsRoot + path.sep)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(statusFile)) {
    // Check if playlist already exists (legacy files without .status)
    const playlistFile = path.join(path.dirname(statusFile), "playlist.m3u8");
    if (fs.existsSync(playlistFile)) {
      return res.json({ status: "ready" });
    }
    return res.json({ status: "not_found" });
  }

  try {
    const data = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    return res.json(data);
  } catch (e) {
    return res.json({ status: "unknown" });
  }
});

// ══════════════════════════════════════════════════════════
// PREVIEW SNIPPET REGENERATION ENDPOINT
// Regenerates the 30s preview clip with custom start/duration
// ══════════════════════════════════════════════════════════
app.post("/preview/regenerate", requireApiKey, async (req, res) => {
  const { storagePath, snippetStart, snippetDuration } = req.body;
  if (!storagePath || typeof storagePath !== "string") {
    return res.status(400).json({ error: "ERROR_STORAGEPATH_IS_REQUIRED" });
  }
  if (!validatePathSegments(storagePath)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  // Find the source audio file
  const baseDir = path.join(__dirname, "uploads");
  const segments = storagePath.split(/[\\/]+/).filter(Boolean);
  const sourceDir = path.join(baseDir, ...segments.slice(0, -1)); // directory containing the file
  const resolvedSource = path.resolve(sourceDir);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedSource.startsWith(resolvedBase + path.sep)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  // Find the audio file (last segment, may be encoded)
  const fileName = decodeURIComponent(segments[segments.length - 1]);
  const sourcePath = path.join(sourceDir, fileName);

  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: "ERROR_SOURCE_AUDIO_FILE_NOT_FOUND" });
  }

  const hlsDir = path.join(sourceDir, "hls");
  const previewFile = path.join(hlsDir, "preview.aac");
  const startSec = Math.max(0, parseInt(snippetStart) || 0);
  const durationSec = Math.min(Math.max(1, parseInt(snippetDuration) || 30), 120); // Cap at 120s

  try {
    await generatePreviewSnippet(sourcePath, previewFile, startSec, durationSec);
    const encodedSegments = segments.slice(0, -1).map(s => encodeURIComponent(s));
    const previewUrl = `/uploads/${encodedSegments.join("/")}/hls/preview.aac`;
    res.json({ success: true, previewUrl, snippetStart: startSec, snippetDuration: durationSec });
  } catch (err) {
    console.error("[Preview] Regeneration failed:", err.message);
    res.status(500).json({ error: "ERROR_PREVIEW_GENERATION_FAILED" });
  }
});

// ══════════════════════════════════════════════════════════
// SIGNED STREAM URL SYSTEM (IDM Anti-Hijack)
// Generates short-lived HMAC-SHA256 signed tokens bound to IP.
// Tokens expire after STREAM_TOKEN_TTL_SEC (default 30 min).
// IDM cannot reuse links because:
//   1. Token expires quickly
//   2. Token is bound to requester's IP
//   3. URL path is encoded inside the token (no path guessing)
// ══════════════════════════════════════════════════════════
const STREAM_TOKEN_TTL_SEC = parseInt(process.env.STREAM_TOKEN_TTL_SEC || "1800"); // 30 minutes

/**
 * Generate a signed stream token.
 * @param {string} streamPath - The path to the media (e.g. "audio/label/release/track/hls/playlist.m3u8")
 * @param {string} clientIp - Requester's IP address
 * @returns {{ token: string, expiresAt: number }}
 */
function generateStreamToken(streamPath, clientIp) {
  // Security audit fix H6: No fallback secret in production
  const secret = UPLOAD_API_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[FATAL] Cannot generate stream tokens without UPLOAD_API_KEY in production");
    }
    console.warn("[DEV] Using insecure fallback secret for stream tokens");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + STREAM_TOKEN_TTL_SEC;
  const payload = {
    p: streamPath,     // path
    ip: clientIp,      // bound IP
    exp: expiresAt,    // expiry
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

/**
 * Verify a signed stream token.
 * @param {string} token - The signed token from query string ?s=
 * @param {string} clientIp - Current requester's IP
 * @returns {{ valid: boolean, path?: string, error?: string }}
 */
function verifyStreamToken(token, clientIp) {
  if (!token) return { valid: false, error: "missing_token" };
  // Security audit fix H6: No fallback secret in production
  const secret = UPLOAD_API_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { valid: false, error: "server_misconfigured" };
    }
  }
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, error: "malformed" };

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  // Constant-time comparison
  const sigBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(sig);
  if (sigBuf.length !== providedBuf.length || !crypto.timingSafeEqual(sigBuf, providedBuf)) {
    return { valid: false, error: "invalid_signature" };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: "expired" };
    }
    // IP binding check (skip in development for localhost variations)
    if (process.env.NODE_ENV === "production" && payload.ip && payload.ip !== clientIp) {
      return { valid: false, error: "ip_mismatch" };
    }
    return { valid: true, path: payload.p };
  } catch (e) {
    return { valid: false, error: "decode_failed" };
  }
}

// ══════════════════════════════════════════════════════════
// STREAM TOKEN SIGNING ENDPOINT
// Frontend calls this to get a signed URL before streaming.
// Requires auth (API key or upload token).
// ══════════════════════════════════════════════════════════
app.post("/stream/sign", requireApiKey, (req, res) => {
  const { paths } = req.body; // array of stream paths to sign
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "ERROR_PATHS_ARRAY_REQUIRED" });
  }
  if (paths.length > 20) {
    return res.status(400).json({ error: "ERROR_MAX_20_PATHS_PER_REQUEST" });
  }

  const clientIp = req.ip || req.connection.remoteAddress || "unknown";
  const signed = paths.map((p) => {
    if (typeof p !== "string" || !p) return { path: p, error: "invalid" };
    const { token, expiresAt } = generateStreamToken(p, clientIp);
    return { path: p, token, expiresAt };
  });

  res.json({ signed });
});

// ══════════════════════════════════════════════════════════
// STREAM AUTHENTICATION MIDDLEWARE
// Validates access via: signed stream token (query ?s=),
//   upload token, API key, or dashboard Referer (dev only)
// ══════════════════════════════════════════════════════════
function requireStreamAuth(req, res, next) {
  // Method 0: Signed stream token (IDM-proof, preferred)
  const signedToken = req.query?.s;
  if (signedToken) {
    const clientIp = req.ip || req.connection.remoteAddress || "unknown";
    const result = verifyStreamToken(signedToken, clientIp);
    if (result.valid) {
      req._signedStreamPath = result.path; // store for optional path validation
      return next();
    }
    // If token present but invalid, reject immediately (don't fall through)
    return res.status(403).json({ error: `ERROR_STREAM_TOKEN_${result.error?.toUpperCase()}` });
  }

  // Method 1: API key (server-to-server)
  const apiKey = req.headers["x-api-key"];
  if (apiKey && apiKey === UPLOAD_API_KEY) {
    return next();
  }

  // Method 2: Upload token (browser with credentials)
  const uploadToken = req.headers["x-upload-token"] || req.query?.token;
  if (uploadToken) {
    const payload = verifyUploadToken(uploadToken);
    if (payload) return next();
  }

  // Method 3: Referer/Origin-based (only in non-production for UX convenience)
  if (process.env.NODE_ENV !== "production") {
    const referer = req.headers.referer || req.headers.referrer || "";
    const origin = req.headers.origin || "";
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";

    if (
      referer.startsWith(dashboardUrl) ||
      origin.startsWith(dashboardUrl) ||
      referer.startsWith("http://localhost:3000") ||
      origin.startsWith("http://localhost:3000") ||
      // In development without UPLOAD_API_KEY, allow all
      !UPLOAD_API_KEY
    ) {
      return next();
    }
  }

  return res.status(403).json({ error: "ERROR_STREAM_ACCESS_DENIED_VALID_TOKEN_OR_API_KEY" });
}

// Stream endpoint to bypass IDM (Internet Download Manager)
// Supports both old UUID format and new labelId/isrc/filename paths
// Usage: /stream/audio/:path (where path can be uuid, uuid.wav, or labelId/isrc/filename.wav)
app.get("/stream/audio/*", requireStreamAuth, async (req, res) => {
  const requestPathRaw = req.params[0] || ""; // everything after /stream/audio/
  const baseDir = path.join(__dirname, "uploads");

  // Security: prevent path traversal
  const resolvedBase = path.resolve(baseDir);

  let filePath = null;

  // If nested path provided (labelId/isrc/filename), validate each segment
  if (requestPathRaw.includes("/") || requestPathRaw.includes("\\\\")) {
    if (!validatePathSegments(requestPathRaw)) {
      return res.status(400).send("Invalid path");
    }
    const directPath = path.join(baseDir, ...requestPathRaw.split(/[\\/]+/));
    if (!path.resolve(directPath).startsWith(resolvedBase)) {
      return res.status(400).send("Invalid path");
    }
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      filePath = directPath;
    }
  }

  // Fallback: old UUID format — try common audio extensions in uploads/audio/
  if (!filePath) {
    const legacyAudioDir = path.join(baseDir, "audio");
    const uuidRaw = path.basename(requestPathRaw || "");
    if (!uuidRaw || !validateFilenameSegment(uuidRaw)) {
      return res.status(400).send("Invalid file identifier");
    }
    const uuid = uuidRaw;
    const audioExts = [
      ".wav",
      ".flac",
      ".mp3",
      ".aac",
      ".m4a",
      ".ogg",
      ".aiff",
      ".wma",
      ".alac",
      ".opus",
    ];
    // If already has extension
    if (audioExts.some((ext) => uuid.toLowerCase().endsWith(ext))) {
      const tryP = path.join(legacyAudioDir, uuid);
      if (fs.existsSync(tryP)) filePath = tryP;
    } else {
      for (const ext of audioExts) {
        const tryPath = path.join(legacyAudioDir, `${uuid}${ext}`);
        if (fs.existsSync(tryPath)) {
          filePath = tryPath;
          break;
        }
      }
    }
  }

  if (!filePath) {
    return res.status(404).send("File not found");
  }

  // Enforce concurrent stream limits using Redis counters
  const clientIp = req.ip || req.connection.remoteAddress || "unknown";
  try {
    const [globalCountRaw, ipCountRaw] = await Promise.all([
      safeGet("streams:global"),
      safeGet(`streams:${clientIp}`),
    ]);
    const globalCount = parseInt(globalCountRaw || "0");
    const ipCount = parseInt(ipCountRaw || "0");
    if (
      globalCount >= MAX_CONCURRENT_STREAMS_GLOBAL ||
      ipCount >= MAX_CONCURRENT_STREAMS_PER_IP
    ) {
      return res.status(429).send("Too many concurrent streams");
    }
    // Increment counters and set TTL
    await Promise.all([
      safeIncr("streams:global"),
      safeIncr(`streams:${clientIp}`),
      safeExpire("streams:global", STREAM_TTL_SEC).catch(() => { }),
      safeExpire(`streams:${clientIp}`, STREAM_TTL_SEC).catch(() => { }),
    ]);
  } catch (e) {
    console.error("Stream counter error:", e.message);
    // Fail open: allow streaming if Redis unavailable
  }

  const filename = path.basename(filePath);
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(filename).toLowerCase();

  // V-3: Block direct streaming of lossless masters — use HLS/preview instead
  if (ext === ".wav" || ext === ".flac") {
    return res
      .status(403)
      .json({
        error: "ERROR_DIRECT_ACCESS_TO_LOSSLESS_FILES_FORBIDDEN_USE_HLS",
      });
  }

  const mimeMap = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".aac": "audio/aac",
    ".ts": "video/mp2t",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
  };

  let contentType = mimeMap[ext] || "application/octet-stream";

  // IDM Anti-hijack headers (mainly for audio, but safe to apply generally)
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // Force inline disposition to discourage IDM
  // Also, obfuscate the filename in the header to be just the UUID without extension if possible?
  // But browser might need it. Let's keep it safe but cleaner.
  try {
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    );
    res.setHeader("Content-Type", contentType);
  } catch (err) {
    console.error("Error setting headers:", err);
    // Fallback if headers still fail
    res.setHeader("Content-Type", "application/octet-stream");
  }

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    // Validate range bounds
    if (
      isNaN(start) ||
      start < 0 ||
      start >= fileSize ||
      end < start ||
      end >= fileSize
    ) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }

    // Limit chunk size to prevent abusive large single-range requests (e.g., 100MB)
    const MAX_RANGE_BYTES = parseInt(
      process.env.MAX_RANGE_BYTES || "104857600",
    );
    if (end - start + 1 > MAX_RANGE_BYTES) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    // Set socket timeout to avoid slow clients holding file descriptors
    req.socket.setTimeout(
      parseInt(process.env.STREAM_SOCKET_TIMEOUT_MS || "30000"),
      () => {
        try {
          file.destroy();
        } catch { }
      },
    );
    const cleanup = async () => {
      try {
        const g = await safeDecr("streams:global");
        const ipv = await safeDecr(`streams:${clientIp}`);
        if (g <= 0) await safeDel("streams:global");
        if (ipv <= 0) await safeDel(`streams:${clientIp}`);
      } catch (e) {
        /* ignore */
      }
    };
    file.on("close", cleanup);
    file.on("end", cleanup);
    file.on("error", cleanup);

    const encodedFilename = encodeURIComponent(filename);
    const head = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    };

    try {
      res.writeHead(206, head);
    } catch (e) {
      delete head["Content-Disposition"];
      res.writeHead(206, head);
    }
    file.pipe(res);
  } else {
    const encodedFilename = encodeURIComponent(filename);
    const head = {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    };
    try {
      res.writeHead(200, head);
    } catch (e) {
      delete head["Content-Disposition"];
      res.writeHead(200, head);
    }
    const stream = fs.createReadStream(filePath);
    const cleanup = async () => {
      try {
        const g = await safeDecr("streams:global");
        const ipv = await safeDecr(`streams:${clientIp}`);
        if (g <= 0) await safeDel("streams:global");
        if (ipv <= 0) await safeDel(`streams:${clientIp}`);
      } catch (e) {
        /* ignore */
      }
    };
    stream.on("close", cleanup);
    stream.on("end", cleanup);
    stream.on("error", cleanup);
    req.socket.setTimeout(
      parseInt(process.env.STREAM_SOCKET_TIMEOUT_MS || "30000"),
      () => {
        try {
          stream.destroy();
        } catch { }
      },
    );
    stream.pipe(res);
  }
});

// ══════════════════════════════════════════════════════════
// VIDEO STREAM ENDPOINT
// Mirrors /stream/audio/* but for video files (MP4, HLS)
// ══════════════════════════════════════════════════════════
app.get("/stream/video/*", requireStreamAuth, async (req, res) => {
  const requestPathRaw = req.params[0] || "";
  const baseDir = path.join(__dirname, "uploads");
  const resolvedBase = path.resolve(baseDir);

  if (!requestPathRaw || !validatePathSegments(requestPathRaw)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  const directPath = path.join(baseDir, ...requestPathRaw.split(/[\\/]+/));
  if (!path.resolve(directPath).startsWith(resolvedBase + path.sep)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(directPath) || !fs.statSync(directPath).isFile()) {
    return res.status(404).json({ error: "ERROR_FILE_NOT_FOUND" });
  }

  // Concurrent stream limits
  const clientIp = req.ip || req.connection.remoteAddress || "unknown";
  try {
    const [globalCountRaw, ipCountRaw] = await Promise.all([
      safeGet("streams:global"), safeGet(`streams:${clientIp}`),
    ]);
    if (parseInt(globalCountRaw || "0") >= MAX_CONCURRENT_STREAMS_GLOBAL ||
      parseInt(ipCountRaw || "0") >= MAX_CONCURRENT_STREAMS_PER_IP) {
      return res.status(429).json({ error: "ERROR_TOO_MANY_CONCURRENT_STREAMS" });
    }
    await Promise.all([
      safeIncr("streams:global"), safeIncr(`streams:${clientIp}`),
      safeExpire("streams:global", STREAM_TTL_SEC).catch(() => { }),
      safeExpire(`streams:${clientIp}`, STREAM_TTL_SEC).catch(() => { }),
    ]);
  } catch (e) { console.error("Stream counter error:", e.message); }

  const filename = path.basename(directPath);
  const ext = path.extname(filename).toLowerCase();
  const stat = fs.statSync(directPath);
  const fileSize = stat.size;

  const mimeMap = {
    ".mp4": "video/mp4",
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    ".mov": "video/quicktime",
    ".json": "application/json",
    ".aac": "audio/aac",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";

  // Anti-IDM headers
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const encodedFilename = encodeURIComponent(filename);
  res.setHeader("Content-Disposition", `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader("Content-Type", contentType);

  const cleanup = async () => {
    try {
      const g = await safeDecr("streams:global");
      const ipv = await safeDecr(`streams:${clientIp}`);
      if (g <= 0) await safeDel("streams:global");
      if (ipv <= 0) await safeDel(`streams:${clientIp}`);
    } catch (e) { /* ignore */ }
  };

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start < 0 || start >= fileSize || end < start || end >= fileSize) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }
    const MAX_RANGE_BYTES = parseInt(process.env.MAX_RANGE_BYTES || "104857600");
    if (end - start + 1 > MAX_RANGE_BYTES) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }
    const chunksize = end - start + 1;
    const file = fs.createReadStream(directPath, { start, end });
    req.socket.setTimeout(parseInt(process.env.STREAM_SOCKET_TIMEOUT_MS || "30000"), () => { try { file.destroy(); } catch { } });
    file.on("close", cleanup); file.on("end", cleanup); file.on("error", cleanup);
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
    });
    file.pipe(res);
  } else {
    const stream = fs.createReadStream(directPath);
    req.socket.setTimeout(parseInt(process.env.STREAM_SOCKET_TIMEOUT_MS || "30000"), () => { try { stream.destroy(); } catch { } });
    stream.on("close", cleanup); stream.on("end", cleanup); stream.on("error", cleanup);
    res.writeHead(200, { "Content-Length": fileSize, "Content-Type": contentType });
    stream.pipe(res);
  }
});

// ══════════════════════════════════════════════════════════
// CANVAS STREAM ENDPOINT (Spotify Canvas — short looping video)
// ══════════════════════════════════════════════════════════
app.get("/stream/canvas/*", requireStreamAuth, async (req, res) => {
  const requestPathRaw = req.params[0] || "";
  const baseDir = path.join(__dirname, "uploads");
  const resolvedBase = path.resolve(baseDir);

  if (!requestPathRaw || !validatePathSegments(requestPathRaw)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  const directPath = path.join(baseDir, ...requestPathRaw.split(/[\\/]+/));
  if (!path.resolve(directPath).startsWith(resolvedBase + path.sep)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(directPath) || !fs.statSync(directPath).isFile()) {
    return res.status(404).json({ error: "ERROR_FILE_NOT_FOUND" });
  }

  const filename = path.basename(directPath);
  const ext = path.extname(filename).toLowerCase();
  const stat = fs.statSync(directPath);
  const fileSize = stat.size;

  const mimeMap = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
  const contentType = mimeMap[ext] || "video/mp4";

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Content-Disposition", `inline; filename="canvas_${encodeURIComponent(filename)}"`);
  res.setHeader("Content-Type", contentType);

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start < 0 || start >= fileSize || end < start || end >= fileSize) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }
    const chunksize = end - start + 1;
    const file = fs.createReadStream(directPath, { start, end });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": fileSize, "Content-Type": contentType });
    fs.createReadStream(directPath).pipe(res);
  }
});

// Delete endpoint — generic for any file inside uploads
app.delete("/file/*", requireApiKey, (req, res) => {
  const subPath = req.params[0] || "";

  if (!validatePathSegments(subPath)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_FORMAT" });
  }

  const filePath = path.join(__dirname, "uploads", ...subPath.split(/[\\/]+/));
  const resolved = path.resolve(filePath);
  const uploadsRoot = path.resolve(__dirname, "uploads");

  // Security: prevent path traversal out of the uploads folder
  if (!resolved.startsWith(uploadsRoot + path.sep)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);

    // Dọn folder rỗng
    const parentDir = path.dirname(filePath);
    try {
      const remaining = fs.readdirSync(parentDir);
      if (remaining.length === 0 && parentDir !== uploadsRoot) {
        fs.rmdirSync(parentDir);
      }
    } catch {
      /* ignore */
    }

    res.json({ success: true, message: "File deleted" });
  } else {
    res.status(404).json({ error: "ERROR_FILE_NOT_FOUND" });
  }
});

// PUT /upload/move — Di chuyển file từ temp sang folder chính thức sau khi form được điền đủ
app.put("/upload/move", requireApiKey, async (req, res) => {
  const { url, type, originalName } = req.body;
  if (!url || !type) {
    return res.status(400).json({ error: "ERROR_MISSING_URL_OR_TYPE" });
  }

  try {
    // Lấy relative path từ url. VD: http://localhost:3001/uploads/temp/audio/uuid/file.wav -> uploads/temp/audio/uuid/file.wav
    const urlObj = new URL(url);
    const pathname = decodeURIComponent(urlObj.pathname).replace(/^\//, "");

    const parts = pathname.split("/");
    if (parts.some((p) => p === ".." || p === ".")) {
      return res.status(400).json({ error: "ERROR_INVALID_PATH_SEGMENTS" });
    }

    if (!pathname.startsWith("uploads/temp/")) {
      return res
        .status(400)
        .json({ error: "ERROR_URL_DOES_NOT_POINT_TO_A_TEMP_FILE" });
    }

    const currentPath = path.join(__dirname, ...parts);
    if (!fs.existsSync(currentPath)) {
      return res.status(404).json({ error: "ERROR_TEMP_FILE_NOT_FOUND_ON_SERVER" });
    }

    const finalName = path.basename(currentPath);

    // Tính toán folder đích
    const safeLabel = sanitizeFilename(
      req.body.labelName || req.body.labelId || "Independent",
    );
    const safeArtist = sanitizeFilename(
      req.body.artistName || "Unknown Artist",
    );
    const safeRelease = sanitizeFilename(
      req.body.releaseTitle ||
      req.body.releaseId ||
      req.body.entityName ||
      "Unknown Release",
    );
    const safeReleaseId = sanitizeFilename(req.body.releaseId || "standalone");

    let folderParts = [];
    if (type === "audio") {
      const safeTrack = sanitizeFilename(
        req.body.trackTitle || originalName?.split(".")[0] || "Unknown Track",
      );
      const trackFolder = `${safeArtist} - ${safeTrack}`;
      folderParts = ["uploads", "audio", safeLabel, safeReleaseId, trackFolder];
    } else if (type === "avatars") {
      const safeEntity = sanitizeFilename(
        req.body.entityName || req.body.entityId || "default",
      );
      folderParts = ["uploads", "avatars", safeEntity];
    } else if (type === "labels") {
      folderParts = ["uploads", safeLabel, "logo"];
    } else if (type === "artists") {
      folderParts = ["uploads", safeLabel, safeArtist, "avatar"];
    } else if (type === "covers") {
      folderParts = ["uploads", safeLabel, safeArtist, safeRelease, "artwork"];
    } else if (type === "video") {
      folderParts = ["uploads", safeLabel, safeArtist, safeRelease, "video"];
    } else if (type === "documents") {
      folderParts = [
        "uploads",
        safeLabel,
        safeArtist,
        safeRelease,
        "documents",
      ];
    } else if (type === "restore") {
      folderParts = ["uploads", "restore"];
    } else {
      const safeEntity = sanitizeFilename(
        req.body.entityName || req.body.entityId || "default",
      );
      folderParts = ["uploads", "general", safeEntity];
    }

    const destDir = path.join(__dirname, ...folderParts);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Xóa file cũ của track nếu là audio
    if (type === "audio" && fs.existsSync(destDir)) {
      try {
        const files = fs.readdirSync(destDir);
        for (const f of files) {
          fs.unlinkSync(path.join(destDir, f));
        }
      } catch (e) {
        console.error("Failed to clean up old files in:", destDir, e);
      }
    }

    const destPath = path.join(destDir, finalName);

    try {
      fs.renameSync(currentPath, destPath);
    } catch (moveErr) {
      fs.copyFileSync(currentPath, destPath);
      try {
        fs.unlinkSync(currentPath);
      } catch { }
    }

    const urlParts = [
      ...folderParts.map((p) => encodeURIComponent(p)),
      encodeURIComponent(finalName),
    ];
    const fileUrl = `/${urlParts.join("/")}`;

    res.json({
      success: true,
      filename: finalName,
      url: fileUrl,
      storagePath: urlParts.slice(1).join("/"),
    });
  } catch (error) {
    console.error("Error in /upload/move:", error);
    res.status(500).json({ error: "ERROR_FAILED_TO_MOVE_FILE" });
  }
});

// PUT /upload/finalize-release — Di chuyển toàn bộ file của Release từ temp sang DDEX path
app.put("/upload/finalize-release", requireApiKey, async (req, res) => {
  const { releaseId } = req.body;
  if (!releaseId) return res.status(400).json({ error: "ERROR_MISSING_RELEASEID" });

  try {
    const relRes = await dbPool.query(
      `
      SELECT 
        r.id AS release_id, r.title AS release_title, r.ean AS upc, r.cover_url,
        a.id AS artist_id, a.name AS artist_name,
        l.id AS label_id, l.name AS label_name,
        be.id AS distributor_id, be.official_name AS distributor_name
      FROM core.releases r
      LEFT JOIN core.artists a ON r.artist_id = a.id
      LEFT JOIN core.labels l ON r.label_id = l.id
      LEFT JOIN core.business_entities be ON l.tenant_id = be.id
      WHERE r.id = $1
    `,
      [releaseId],
    );

    if (relRes.rows.length === 0) {
      return res.status(404).json({ error: "ERROR_RELEASE_NOT_FOUND" });
    }

    const rel = relRes.rows[0];
    const distId = rel.distributor_id || "00000000-0000-0000-0000-000000000000";
    const distName = rel.distributor_name || "beAlpha";
    const labelId = rel.label_id || "00000000-0000-0000-0000-000000000000";
    const labelName = rel.label_name || "Independent";
    const artistId = rel.artist_id || "00000000-0000-0000-0000-000000000000";
    const artistName = rel.artist_name || "Unknown Artist";
    const upc = rel.upc || "NoUPC";
    const releaseTitle = rel.release_title || "Unknown Release";

    const sanitize = (name) =>
      name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();

    const distFolder = sanitize(`${distId}_${distName}`);
    const labelFolder = sanitize(`${labelId}_${labelName}`);
    const artistFolder = sanitize(`${artistId}_${artistName}`);
    const releaseFolder = sanitize(`${upc}_${releaseTitle}`);

    const baseDdexPathParts = [
      "storage",
      distFolder,
      labelFolder,
      artistFolder,
      "releases",
      releaseFolder,
    ];

    const moveFile = (fileUrl, subFolder) => {
      if (!fileUrl || !fileUrl.includes("/uploads/temp/")) return fileUrl;
      try {
        const urlObj = new URL(fileUrl);
        const pathname = decodeURIComponent(urlObj.pathname).replace(/^\//, "");

        const parts = pathname.split("/");
        if (parts.some((p) => p === ".." || p === ".")) {
          console.warn("Invalid path segments in finalize-release:", pathname);
          return fileUrl;
        }

        const currentPath = path.join(__dirname, ...parts);

        if (!fs.existsSync(currentPath)) return fileUrl;

        const finalName = path.basename(currentPath);
        const destParts = [...baseDdexPathParts, subFolder];
        const destDir = path.join(__dirname, ...destParts);

        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        if (subFolder === "cover_art" && fs.existsSync(destDir)) {
          try {
            const files = fs.readdirSync(destDir);
            for (const f of files) fs.unlinkSync(path.join(destDir, f));
          } catch (e) { }
        }

        const destPath = path.join(destDir, finalName);
        try {
          fs.renameSync(currentPath, destPath);
        } catch (moveErr) {
          fs.copyFileSync(currentPath, destPath);
          try {
            fs.unlinkSync(currentPath);
          } catch { }
        }

        const newUrlParts = [
          ...destParts.map((p) => encodeURIComponent(p)),
          encodeURIComponent(finalName),
        ];
        return `/${newUrlParts.join("/")}`;
      } catch (e) {
        console.error("Error moving file:", fileUrl, e);
        return fileUrl;
      }
    };

    let updated = false;

    if (rel.cover_url && rel.cover_url.includes("/uploads/temp/")) {
      const newCoverUrl = moveFile(rel.cover_url, "cover_art");
      if (newCoverUrl !== rel.cover_url) {
        await dbPool.query(
          "UPDATE core.releases SET cover_url = $1 WHERE id = $2",
          [newCoverUrl, releaseId],
        );
        updated = true;
      }
    }

    // BUG-1+3 fix: Query all assets linked to this release and update core.assets
    // (the Track table has no file_url column - audio is stored via Asset FK)
    const assetsRes = await dbPool.query(
      `SELECT id, file_url, type FROM core.assets
       WHERE release_id = $1 AND file_url LIKE '%/uploads/temp/%'`,
      [releaseId],
    );
    for (const asset of assetsRes.rows) {
      const subFolderMap = { AUDIO: "audio", VIDEO: "video", CANVAS: "canvas", MOTION: "motion" };
      const subFolder = subFolderMap[asset.type] || "assets";
      const newAssetUrl = moveFile(asset.file_url, subFolder);
      if (newAssetUrl !== asset.file_url) {
        await dbPool.query(
          "UPDATE core.assets SET file_url = $1 WHERE id = $2",
          [newAssetUrl, asset.id],
        );
        updated = true;
      }
    }

    // Also finalize track-level assets not directly linked to the release
    const trackAssetsRes = await dbPool.query(
      `SELECT DISTINCT ast.id, ast.file_url, ast.type FROM core.tracks t
       JOIN core.assets ast ON ast.id IN (t.audio_asset_id, t.canvas_asset_id, t.motion_asset_id, t.adm_asset_id)
       WHERE t.release_id = $1 AND ast.file_url LIKE '%/uploads/temp/%'
         AND (ast.release_id IS NULL OR ast.release_id != $1)`,
      [releaseId],
    );
    for (const asset of trackAssetsRes.rows) {
      const subFolderMap = { AUDIO: "audio", VIDEO: "video", CANVAS: "canvas", MOTION: "motion" };
      const subFolder = subFolderMap[asset.type] || "assets";
      const newAssetUrl = moveFile(asset.file_url, subFolder);
      if (newAssetUrl !== asset.file_url) {
        await dbPool.query(
          "UPDATE core.assets SET file_url = $1 WHERE id = $2",
          [newAssetUrl, asset.id],
        );
        updated = true;
      }
    }

    res.json({ success: true, message: "Release files finalized", updated });
  } catch (error) {
    console.error("Error in /upload/finalize-release:", error);
    res
      .status(500)
      .json({
        error: "ERROR_FAILED_TO_FINALIZE_RELEASE" + (error.message || String(error)),
      });
  }
});

app.post("/upload/export/ddex", requireApiKey, async (req, res) => {
  const { releaseId, xml } = req.body;
  if (!releaseId || !xml)
    return res.status(400).json({ error: "ERROR_MISSING_RELEASEID_OR_XML" });

  try {
    const relRes = await dbPool.query(
      `
      SELECT 
        r.id AS release_id, r.title AS release_title, r.ean AS upc, r.cover_url,
        a.id AS artist_id, a.name AS artist_name,
        l.id AS label_id, l.name AS label_name,
        be.id AS distributor_id, be.official_name AS distributor_name
      FROM core.releases r
      LEFT JOIN core.artists a ON r.artist_id = a.id
      LEFT JOIN core.labels l ON r.label_id = l.id
      LEFT JOIN core.business_entities be ON l.tenant_id = be.id
      WHERE r.id = $1
    `,
      [releaseId],
    );

    if (relRes.rows.length === 0)
      return res.status(404).json({ error: "ERROR_RELEASE_NOT_FOUND" });

    const rel = relRes.rows[0];
    const distId = rel.distributor_id || "00000000-0000-0000-0000-000000000000";
    const distName = rel.distributor_name || "beAlpha";
    const labelId = rel.label_id || "00000000-0000-0000-0000-000000000000";
    const labelName = rel.label_name || "Independent";
    const artistId = rel.artist_id || "00000000-0000-0000-0000-000000000000";
    const artistName = rel.artist_name || "Unknown Artist";
    const upc = rel.upc || "NoUPC";
    const releaseTitle = rel.release_title || "Unknown Release";

    const sanitize = (name) =>
      name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();

    const distFolder = sanitize(`${distId}_${distName}`);
    const labelFolder = sanitize(`${labelId}_${labelName}`);
    const artistFolder = sanitize(`${artistId}_${artistName}`);
    const releaseFolder = sanitize(`${upc}_${releaseTitle}`);

    const releaseDir = path.join(
      __dirname,
      "storage",
      distFolder,
      labelFolder,
      artistFolder,
      "releases",
      releaseFolder,
    );

    if (!fs.existsSync(releaseDir)) {
      return res
        .status(400)
        .json({
          error: "ERROR_RELEASE_FILES_NOT_FINALIZED_YET_PLEASE_SAVE",
        });
    }

    fs.writeFileSync(path.join(releaseDir, "metadata.xml"), xml, "utf-8");

    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addLocalFolder(releaseDir);

    const zipBuffer = zip.toBuffer();

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="DDEX_${releaseFolder}.zip"`,
      "Content-Length": zipBuffer.length,
    });

    res.send(zipBuffer);
  } catch (error) {
    console.error("Error in /upload/export/ddex:", error);
    res
      .status(500)
      .json({ error: "ERROR_FAILED_TO_GENERATE_DDEX_ZIP" });
  }
});

// Cleanup temp files older than 24 hours
setInterval(
  () => {
    const tempDir = path.join(__dirname, "uploads", "temp");
    if (!fs.existsSync(tempDir)) return;

    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    function cleanDir(dir) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            cleanDir(fullPath);
            try {
              fs.rmdirSync(fullPath);
            } catch { }
          } else {
            if (now - stat.mtimeMs > maxAge) {
              fs.unlinkSync(fullPath);
            }
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    cleanDir(tempDir);
  },
  60 * 60 * 1000,
); // Run every hour

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({
          error: "ERROR_FILE_TOO_LARGE_PLEASE_CHECK_THE_FILE_SIZE_LI",
        });
    }
    return res.status(400).json({ error: "ERROR_UPLOAD_PROCESSING_ERROR" });
  }
  res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
});

app.listen(PORT, () => {
  console.log(`Upload server running at http://localhost:${PORT}`);
  console.log(`Uploads available at http://localhost:${PORT}/uploads`);
});
