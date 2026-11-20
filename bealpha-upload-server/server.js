require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
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
const { safeJoinUnder, isSafeEntryName } = require("./lib/safe-path");

const MEDIA_EXEC_TIMEOUT_MS = Number.parseInt(
  process.env.MEDIA_EXEC_TIMEOUT_MS || "120000",
  10,
);
const MEDIA_EXEC_MAX_BUFFER = Number.parseInt(
  process.env.MEDIA_EXEC_MAX_BUFFER || String(4 * 1024 * 1024),
  10,
);
const FFMPEG_JOB_TIMEOUT_MS = Number.parseInt(
  process.env.FFMPEG_JOB_TIMEOUT_MS || String(6 * 60 * 60 * 1000),
  10,
);
const MAX_UPLOAD_TOKEN_TTL_SEC = Number.parseInt(
  process.env.MAX_UPLOAD_TOKEN_TTL_SEC || "900",
  10,
);

function execMediaTool(command, args) {
  return execFile(command, args, {
    timeout: MEDIA_EXEC_TIMEOUT_MS,
    maxBuffer: MEDIA_EXEC_MAX_BUFFER,
  });
}

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
const MAX_MEDIA_QUEUE_DEPTH = Number.parseInt(
  process.env.MAX_MEDIA_QUEUE_DEPTH || "1000",
  10,
);

async function enqueueMediaJob(name, data) {
  const counts = await mediaQueue.getJobCounts();
  const depth = Object.values(counts).reduce(
    (total, count) => total + (typeof count === "number" ? count : 0),
    0,
  );
  if (depth >= MAX_MEDIA_QUEUE_DEPTH) {
    throw new Error("ERROR_MEDIA_QUEUE_FULL");
  }
  return mediaQueue.add(name, data);
}

const mediaWorker = new Worker("media-processing", async (job) => {
  console.log(`[Job ${job.id}] Started processing: ${job.name}`);
  const { inputPath, outputDir, peaksPath, previewPath } = job.data;

  try {
    if (job.name === "process-audio") {
      // 1. Generate HLS
      const hlsDir = safeJoinUnder(outputDir, "hls");
      if (!hlsDir) throw new Error("ERROR_INVALID_HLS_OUTPUT_DIR");
      await generateHLS(inputPath, hlsDir);
      // 2. Generate waveform peaks
      await generatePeaks(inputPath, peaksPath);
      // 3. Generate preview snippet
      await generatePreviewSnippet(inputPath, previewPath);
    } else if (job.name === "process-video") {
      // 1. Generate Video HLS
      const hlsDir = safeJoinUnder(outputDir, "hls");
      if (!hlsDir) throw new Error("ERROR_INVALID_HLS_OUTPUT_DIR");
      await generateVideoHLS(inputPath, hlsDir);
      // 2. Generate video preview snippet
      await generateVideoPreviewSnippet(inputPath, previewPath);
    }
    console.log("[Job %s] Completed successfully.", job.id);
  } catch (err) {
    console.error("[Job %s] Failed: %s", job.id, err && err.message ? err.message : err);
    throw err;
  }
}, {
  connection: redis,
  concurrency: 2, // Process up to 2 heavy media jobs concurrently
});

mediaWorker.on("failed", (job, err) => {
  console.error("[BullMQ] Job %s failed: %s", job && job.id, err && err.message);
});

const app = express();

// ZAP fix: remove "X-Powered-By: Express" fingerprint header.
app.disable("x-powered-by");

// ZAP fix: baseline security headers via helmet.
//  - contentSecurityPolicy: this server only serves JSON + static media (no HTML
//    documents from app routes), but ZAP still wants a CSP that defines
//    default-src so embedded resources can't fall through to unsafe defaults.
//  - crossOriginResourcePolicy: must allow cross-site so the dashboard (different
//    origin) can <img>/<audio> uploaded media. CORS for /uploads is enforced
//    separately by the explicit middleware below.
//  - crossOriginEmbedderPolicy / crossOriginOpenerPolicy: leave default off for
//    media compatibility; these matter on HTML response endpoints, not API/media.
//  - hsts: keep helmet default (only sent over HTTPS by the browser anyway).
//  - permissionsPolicy is not set by helmet 8 — added explicitly below.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  }),
);

// ZAP fix: Permissions-Policy header. Disable all powerful features by default;
// this server has no UI, so no browser API is legitimate from its responses.
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "screen-wake-lock=()",
      "sync-xhr=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  );
  next();
});

// SEC: trust only the documented proxy hop count so req.ip returns the real
// client address and not whatever the request body smuggled in x-forwarded-for.
// Default 1 = nginx (or dashboard /api/stream/sign proxy) sits directly in front.
// In dev (no proxy), set TRUST_PROXY_HOPS=0 so req.ip falls back to socket addr.
const trustProxyHops = Number.parseInt(
  process.env.TRUST_PROXY_HOPS ?? "1",
  10,
);
if (!Number.isFinite(trustProxyHops) || trustProxyHops < 0) {
  throw new Error(
    `Invalid TRUST_PROXY_HOPS=${process.env.TRUST_PROXY_HOPS} (must be non-negative integer)`,
  );
}
app.set("trust proxy", trustProxyHops);

// Start S3 Receipt Polling
const { startS3Polling } = require("./s3-receipt-worker");
startS3Polling();

// Security audit fix H2: Removed duplicate CORS config block (was dead code).
// CORS is now configured once below after ALLOWED_ORIGINS definition.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: process.env.URLENCODED_BODY_LIMIT || "1mb",
  parameterLimit: 100,
}));

// ZAP fix: API responses must not be cached by proxies/browsers. /uploads/* is
// excluded (static media has its own Cache-Control set by express.static below).
app.use((req, res, next) => {
  if (!req.path.startsWith("/uploads")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
// SEC-C2/C3: Gate the static /uploads serving. The previous `express.static`
// exposed every file on disk — including audio masters, signed contracts, and
// the new neutral staging area — to anyone who could guess a path.
//
// New rules:
//   • `.staging` is never served (only internal multer writes land there).
//   • Sensitive subtrees (audio masters, ADM, restore packages, documents,
//     temp, general, motion/canvas pre-release video, DDEX archive) MUST be
//     requested via the signed /stream/* endpoints or the dedicated
//     /upload/export/ddex flow.
//   • HLS playlist/segment + preview snippets remain blocked here too.
//   • Other subtrees (artwork, covers, avatars, video thumbnails,
//     store-specific artwork) remain readable so <img src> in the
//     dashboard keeps working, but only when the request carries a recognised
//     origin/Referer, an API key, an upload token, or a stream token.
//
// `video`, `motion`, and `canvas` are unreleased video assets — leaking any is a
// content-IP incident, so the Origin-reflection escape hatch (which any
// non-browser client can forge by setting an Origin header) is not safe for
// them. `ddex` holds the post-approval ERN snapshot + master copies and must
// never be reachable through the public /uploads/ path.
const SENSITIVE_UPLOAD_TOP_DIRS = new Set([
  "audio",
  "adm",
  "restore",
  "documents",
  "temp",
  "general",
  "video",
  "motion",
  "canvas",
  "ddex",
  "ddex-imports",
]);

function looksLikeAllowedClient(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const ref = referer ? (() => {
    try { return new URL(referer).origin; } catch (e) { return ""; }
  })() : "";
  const fromOrigin = origin && (ALLOWED_ORIGINS.includes(origin) || isLocalOrLanOrigin(origin));
  const fromReferer = ref && (ALLOWED_ORIGINS.includes(ref) || isLocalOrLanOrigin(ref));
  return Boolean(fromOrigin || fromReferer);
}

function uploadsAccessGate(req, res, next) {
  let decoded;
  try {
    decoded = decodeURIComponent(req.path);
  } catch (e) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }
  const lower = decoded.toLowerCase();
  const segs = decoded.split(/[\\/]+/).filter(Boolean);

  // Reject traversal, hidden files, and the neutral staging area.
  if (segs.some((s) => s === ".." || s.startsWith(".."))) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }
  if (segs[0] === ".staging" || segs[0]?.startsWith(".")) {
    return res.status(404).end();
  }

  // HLS / preview / peaks always go through /stream/* — never raw.
  if (
    lower.endsWith(".m3u8") ||
    lower.endsWith(".ts") ||
    lower.includes("/hls/") ||
    lower.endsWith("peaks.json")
  ) {
    return res.status(403).json({
      error: "ERROR_DIRECT_ACCESS_TO_STREAMING_CONTENT_IS_FORBID",
    });
  }

  // Sensitive subtrees: refuse unconditionally. Callers must use signed /stream
  // endpoints which do tenant + token verification.
  if (segs.length > 0 && SENSITIVE_UPLOAD_TOP_DIRS.has(segs[0].toLowerCase())) {
    return res.status(403).json({ error: "ERROR_USE_STREAM_ENDPOINT" });
  }

  // For non-sensitive content, accept any of:
  //   • server-to-server API key
  //   • signed upload token
  //   • signed stream token (?token=...)
  //   • request origin/Referer from the dashboard allow-list
  const headerKey =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");
  if (apiKeyMatches(headerKey)) return next();

  const uploadToken = req.headers["x-upload-token"];
  if (uploadToken && verifyUploadToken(uploadToken)) return next();

  const streamToken = req.query?.token || req.query?.t || req.query?.s;
  if (typeof streamToken === "string" && streamToken) {
    try {
      const ip = req.ip || req.connection?.remoteAddress || "";
      const v = verifyStreamToken(streamToken, ip);
      if (v && v.valid && (!v.path || v.path === decoded)) return next();
    } catch (e) { /* fall through */ }
  }

  if (looksLikeAllowedClient(req)) return next();

  return res.status(401).json({ error: "ERROR_UNAUTHORIZED" });
}

app.use("/uploads", (req, res, next) => rateLimitMiddleware(req, res, next));
app.use("/uploads", uploadsAccessGate);
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  dotfiles: "deny",
  index: false,
  fallthrough: false,
}));

// /storage is for server-internal artefacts (DDEX exports etc.) — refuse all
// external GETs unconditionally. Server-to-server callers go through the
// dedicated /upload/export/ddex endpoint.
app.use("/storage", (req, res) => {
  return res.status(403).json({ error: "ERROR_INTERNAL_ONLY" });
});
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
  // SEC-L2: X-XSS-Protection removed — modern browsers ignore it and on legacy
  // IE/Edge the filter has been documented to reintroduce XSS instead of
  // preventing it. CSP below is the actual defence.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "script-src 'none'",
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
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
 * Sanitize filename: keep the original-ish name but strip anything that could
 * break the filesystem or escape its directory. SEC-M4 hardens against
 * homoglyph-style attacks (bidi overrides, zero-width chars) that let an
 * attacker craft a filename that *looks* like one extension but resolves to
 * another inside a UI that respects bidi.
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "";
  // Only take the last path segment if client sent a path
  const base = path.basename(name);
  let normalized;
  try {
    normalized = base.normalize("NFC");
  } catch (e) {
    normalized = base;
  }
  let out = normalized
    // Bidi overrides + invisible separators + zero-width joiners that can hide
    // the real extension in the rendered string.
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, "")
    // Windows / POSIX reserved + control chars
    .replace(/[<>:"|\\?*\x00-\x1f\x7f]/g, "_")
    // Path traversal sequences
    .replace(/\.\./g, "_")
    // Strip leading dots so we never produce dotfiles
    .replace(/^\.+/, "_")
    .replace(/\s+/g, " ")
    .trim();
  // Limit length while preserving the extension. Naive slice(0, 200) would chop
  // ".flac" off a long filename and break magic-header → extension reconciliation
  // downstream, so the file would be saved without an extension at all.
  const MAX_LEN = 200;
  if (out.length > MAX_LEN) {
    const ext = path.extname(out);
    // Discard pathological extensions ( > 16 chars or containing whitespace ) so
    // a long extension can't push the base name down to nothing.
    const safeExt = ext && ext.length <= 16 && !/\s/.test(ext) ? ext : "";
    const baseOnly = safeExt ? out.slice(0, out.length - safeExt.length) : out;
    const budget = MAX_LEN - safeExt.length;
    out = (budget > 0 ? baseOnly.slice(0, budget) : baseOnly.slice(0, 1)) + safeExt;
  }
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

/**
 * Stream-hash a file to MD5 + SHA256 in a single pass. Used for upload
 * integrity receipts and for the per-file checksum sidecars that ship
 * inside .itmsp packages.
 */
function computeFileHashes(filePath) {
  return new Promise((resolve, reject) => {
    const md5 = crypto.createHash("md5");
    const sha256 = crypto.createHash("sha256");
    let bytes = 0;
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      md5.update(chunk);
      sha256.update(chunk);
    });
    stream.on("end", () => resolve({ md5: md5.digest("hex"), sha256: sha256.digest("hex"), sizeBytes: bytes }));
    stream.on("error", reject);
  });
}

function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

/**
 * Spotify Canvas seamless-loop check via SSIM between first and last frame.
 * Returns { ok, ssim, threshold, reason? }. Soft signal — never throws; on
 * any tooling failure returns { ok: null } so callers can ignore gracefully.
 */
async function verifyCanvasSeamlessLoop(filePath, durationSec) {
  const THRESHOLD = 0.85;
  const tmpDir = path.join(__dirname, "tmp", "canvas-loop-" + crypto.randomUUID());
  const firstFrame = path.join(tmpDir, "first.png");
  const lastFrame = path.join(tmpDir, "last.png");
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    await execMediaTool("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", "0", "-i", filePath, "-frames:v", "1", firstFrame,
    ]);
    // Seek slightly before EOF — last frame may be partial in some containers.
    const tailSeek = Math.max(0, (durationSec || 0) - 0.05);
    await execMediaTool("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(tailSeek), "-i", filePath, "-frames:v", "1", lastFrame,
    ]);
    const { stderr } = await execMediaTool("ffmpeg", [
      "-hide_banner",
      "-i", firstFrame, "-i", lastFrame,
      "-lavfi", "ssim",
      "-f", "null", "-",
    ]);
    const match = stderr.match(/All:\s*(\d+(?:\.\d+)?)/);
    if (!match) {
      return { ok: null, reason: "ssim_unparseable" };
    }
    const ssim = parseFloat(match[1]);
    return { ok: ssim >= THRESHOLD, ssim: Math.round(ssim * 1000) / 1000, threshold: THRESHOLD };
  } catch (err) {
    return { ok: null, reason: "probe_failed", error: err.message };
  } finally {
    try {
      if (fs.existsSync(firstFrame)) fs.unlinkSync(firstFrame);
      if (fs.existsSync(lastFrame)) fs.unlinkSync(lastFrame);
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
    } catch { }
  }
}

/**
 * Apple Motion Art aspect validator. Accepts 3:4 (portrait) or 1:1 (square)
 * within a ±2% tolerance so an off-by-a-pixel encode doesn't fail validation.
 * Returns { ok, aspect, width, height, ratio } where aspect ∈ {"3:4","1:1"}
 * when ok, else { ok:false, width, height, ratio }.
 */
async function validateMotionAspect(filePath) {
  const TOLERANCE = 0.02;
  try {
    const meta = await probeMedia(filePath);
    const stream = (meta.streams || []).find((s) => s.codec_type === "video");
    if (!stream || !stream.width || !stream.height) {
      return { ok: false, reason: "no_video_stream" };
    }
    const width = stream.width;
    const height = stream.height;
    const ratio = width / height;
    const targets = [
      { aspect: "1:1", value: 1.0 },
      { aspect: "3:4", value: 3 / 4 },
    ];
    for (const t of targets) {
      if (Math.abs(ratio - t.value) / t.value <= TOLERANCE) {
        return { ok: true, aspect: t.aspect, width, height, ratio };
      }
    }
    return { ok: false, width, height, ratio };
  } catch (err) {
    return { ok: false, reason: "probe_failed", error: err.message };
  }
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
const MAX_MEMORY_COUNTER_KEYS = Number.parseInt(
  process.env.MAX_MEMORY_COUNTER_KEYS || "10000",
  10,
);

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
  if (!_memCounters.has(key) && _memCounters.size >= MAX_MEMORY_COUNTER_KEYS) {
    const oldestKey = _memCounters.keys().next().value;
    if (oldestKey) {
      _memCounters.delete(oldestKey);
      _clearMemTimer(oldestKey);
    }
  }
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
  t.unref?.();
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
  t.unref?.();
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

async function cleanupStreamCounters(clientIp) {
  try {
    const g = await safeDecr("streams:global");
    const ipv = await safeDecr(`streams:${clientIp}`);
    if (g <= 0) await safeDel("streams:global");
    if (ipv <= 0) await safeDel(`streams:${clientIp}`);
  } catch (e) {
    /* ignore */
  }
}

async function acquireStreamSlot(clientIp) {
  const [globalCountRaw, ipCountRaw] = await Promise.all([
    safeGet("streams:global"),
    safeGet(`streams:${clientIp}`),
  ]);
  const globalCount = parseInt(globalCountRaw || "0", 10);
  const ipCount = parseInt(ipCountRaw || "0", 10);
  if (
    globalCount >= MAX_CONCURRENT_STREAMS_GLOBAL ||
    ipCount >= MAX_CONCURRENT_STREAMS_PER_IP
  ) {
    return false;
  }
  await Promise.all([
    safeIncr("streams:global"),
    safeIncr(`streams:${clientIp}`),
    safeExpire("streams:global", STREAM_TTL_SEC).catch(() => { }),
    safeExpire(`streams:${clientIp}`, STREAM_TTL_SEC).catch(() => { }),
  ]);
  return true;
}
// CORS — restrict to known origins
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.DASHBOARD_URL,
  process.env.CORS_ORIGIN,
].filter(Boolean);

// Dynamic check for LAN / ZeroTier / Tailscale IPs (192.168.x.x, 10.x.x.x,
// 172.16-31.x.x, 26.x.x.x).
//
// IMPORTANT: this reflects credentialed cross-origin requests back to ANY host
// in those ranges. A phishing page hosted on a LAN address (or VPN peer) could
// trivially read /uploads/ media via authenticated fetch. Gated behind
// ALLOW_LAN_ORIGINS=true so production never reflects unvetted LAN origins by
// accident. localhost is always allowed so docker compose dev works.
const ALLOW_LAN_ORIGINS = process.env.ALLOW_LAN_ORIGINS === "true";
function isLocalOrLanOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (!ALLOW_LAN_ORIGINS) return false;
    return (
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
  // nosemgrep: javascript.express.security.audit.express-cors-misconfiguration.express-cors-misconfiguration
  // Reason: dynamic origin reflection is gated by an explicit allow-list (ALLOWED_ORIGINS)
  // plus RFC1918/VPN host check (isLocalOrLanOrigin). cb is never called with `true` for an
  // un-vetted origin — only for same-origin / no-origin server-to-server callers.
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

// Add CORS headers for static files — restrict to the same allow-list as the
// main cors() middleware. SEC-H2: the previous endsWith(":3000")/endsWith(":3001")
// + NODE_ENV==="development" fallback allowed any origin on those ports
// (including evil.com:3000) to read uploaded content cross-origin.
app.use("/uploads", (req, res, next) => {
  const reqOrigin = req.headers.origin;
  if (
    reqOrigin &&
    (ALLOWED_ORIGINS.includes(reqOrigin) || isLocalOrLanOrigin(reqOrigin))
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

// SEC-H4: refuse to boot outside development without an API key. Without one,
// requireApiKey falls through to next() and authentication is fully bypassed.
if (process.env.NODE_ENV !== "development" && !UPLOAD_API_KEY) {
  console.error(
    "[FATAL] UPLOAD_API_KEY is required outside development. Refusing to start.",
  );
  process.exit(1);
}

// SEC-H3: constant-time comparison helper. Replaces `provided === UPLOAD_API_KEY`
// sites that leaked timing information about the key under remote attack.
function apiKeyMatches(provided) {
  if (!provided || !UPLOAD_API_KEY) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(UPLOAD_API_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEC-C1: Tenant resolution + access helpers.
//
// The browser-issued upload token carries the caller's `entityPath` (an
// ltree-style dot-separated chain rooted at the platform). A caller may write
// to/read any tenant that is themselves or a descendant. We refuse anything
// outside that subtree, even if req.body claims an arbitrary id.
//
// Server-key callers are unscoped (server-to-server, trusted).
// ─────────────────────────────────────────────────────────────────────────────
const UUID_RE_GLOBAL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === "string" && UUID_RE_GLOBAL.test(v);
}

// Plan §148: optional tenant-scoped storage layout.
//   uploads/{tenantId}/{ownerId}/releases/{releaseId}/{kind}/...
// Enable via env: USE_TENANT_STORAGE_LAYOUT=true. Default off keeps existing
// behavior so already-stored fileUrl values remain reachable. When enabled,
// new uploads use the structured prefix; old uploads stay accessible because
// fileUrl in core.releases/core.tracks stores the full path verbatim.
const USE_TENANT_STORAGE_LAYOUT = process.env.USE_TENANT_STORAGE_LAYOUT === "true";

function buildTenantScopedFolderParts(kind, tenantId, ownerId, releaseId, leafSegments = []) {
  if (!isUuid(tenantId) || !isUuid(releaseId)) return null;
  const safeOwner = isUuid(ownerId) ? ownerId : tenantId;
  return [
    "uploads",
    tenantId,
    safeOwner,
    "releases",
    releaseId,
    kind,
    ...leafSegments.filter(Boolean).map((s) => sanitizeFilename(String(s))),
  ];
}

async function getTenantPathById(tenantId) {
  if (!isUuid(tenantId)) return null;
  try {
    const r = await dbPool.query(
      "SELECT path FROM core.business_entities WHERE id = $1",
      [tenantId],
    );
    return r.rows[0]?.path || null;
  } catch (e) {
    console.error("[SEC-C1] getTenantPathById:", e.message);
    return null;
  }
}

async function resolveTenantForRelease(releaseId) {
  if (!isUuid(releaseId)) return null;
  try {
    const r = await dbPool.query(
      "SELECT tenant_id FROM core.releases WHERE id = $1",
      [releaseId],
    );
    return r.rows[0]?.tenant_id || null;
  } catch (e) {
    console.error("[SEC-C1] resolveTenantForRelease:", e.message);
    return null;
  }
}

// Plan §148: per-tenant per-owner storage layout.
// Returns { tenantId, ownerId } so callers can build:
//   uploads/{tenantId}/{ownerId}/releases/{releaseId}/...
async function resolveOwnershipForRelease(releaseId) {
  if (!isUuid(releaseId)) return null;
  try {
    const r = await dbPool.query(
      "SELECT tenant_id, owner_id FROM core.releases WHERE id = $1",
      [releaseId],
    );
    if (!r.rows[0]) return null;
    return {
      tenantId: r.rows[0].tenant_id || null,
      ownerId: r.rows[0].owner_id || r.rows[0].tenant_id || null,
    };
  } catch (e) {
    console.error("[SEC-C1] resolveOwnershipForRelease:", e.message);
    return null;
  }
}

async function resolveTenantForLabel(labelId) {
  if (!isUuid(labelId)) return null;
  try {
    const r = await dbPool.query(
      "SELECT tenant_id FROM core.labels WHERE id = $1",
      [labelId],
    );
    return r.rows[0]?.tenant_id || null;
  } catch (e) {
    console.error("[SEC-C1] resolveTenantForLabel:", e.message);
    return null;
  }
}

async function resolveTenantForArtist(artistId) {
  if (!isUuid(artistId)) return null;
  try {
    const r = await dbPool.query(
      "SELECT tenant_id FROM core.artists WHERE id = $1",
      [artistId],
    );
    return r.rows[0]?.tenant_id || null;
  } catch (e) {
    console.error("[SEC-C1] resolveTenantForArtist:", e.message);
    return null;
  }
}

async function resolveTenantForTrack(trackId) {
  if (!isUuid(trackId)) return null;
  try {
    const r = await dbPool.query(
      `SELECT r.tenant_id
         FROM core.tracks t
         JOIN core.releases r ON r.id = t.release_id
        WHERE t.id = $1`,
      [trackId],
    );
    return r.rows[0]?.tenant_id || null;
  } catch (e) {
    console.error("[SEC-C1] resolveTenantForTrack:", e.message);
    return null;
  }
}

/**
 * Given a relative storage path (e.g. "audio/Foo/release-id/.../file.wav"), look
 * across the asset / release / label / artist tables to find the owning tenant.
 * Returns null when no match is found.
 *
 * Used by /stream/sign, /upload/move, and DELETE /file/* to refuse path
 * references that the caller has no claim over.
 */
async function findTenantForStoragePath(p) {
  if (!p || typeof p !== "string") return null;
  const key = p.replace(/^\/+/, "").replace(/^uploads\//, "");
  const candidates = [
    key,
    "/" + key,
    "uploads/" + key,
    "/uploads/" + key,
  ];
  try {
    const r = await dbPool.query(
      `SELECT tenant_id FROM (
         SELECT tenant_id FROM core.assets   WHERE file_url        = ANY($1)
         UNION ALL
         SELECT tenant_id FROM core.releases WHERE cover_url        = ANY($1)
         UNION ALL
         SELECT tenant_id FROM core.releases WHERE motion_url       = ANY($1)
         UNION ALL
         SELECT tenant_id FROM core.releases WHERE tidal_artwork_url = ANY($1)
         UNION ALL
         SELECT tenant_id FROM core.releases WHERE amazon_artwork_url = ANY($1)
         UNION ALL
         SELECT tenant_id FROM core.labels   WHERE logo_url         = ANY($1)
         UNION ALL
         SELECT tenant_id FROM core.artists  WHERE image_url        = ANY($1)
       ) q
       WHERE tenant_id IS NOT NULL
       LIMIT 1`,
      [candidates],
    );
    return r.rows[0]?.tenant_id || null;
  } catch (e) {
    console.error("[SEC-H1] findTenantForStoragePath:", e.message);
    return null;
  }
}

/**
 * Returns true if the caller's token grants access to `tenantId`.
 * Server-key callers bypass.
 * Browser callers must own a path that is an ancestor-or-self of `tenantId`'s path.
 */
async function isTenantAccessible(req, tenantId) {
  if (req.uploadIsServerKey) return true;
  if (!tenantId) return false;
  const callerPath = req.uploadEntityPath;
  if (!callerPath) return false;
  // Self
  if (req.uploadEntityId === tenantId) return true;
  const targetPath = await getTenantPathById(tenantId);
  if (!targetPath) return false;
  return targetPath === callerPath || targetPath.startsWith(callerPath + ".");
}

/**
 * Inspect req.body for tenant-bearing references and return the resolved tenant id
 * (the deepest unambiguous one). If multiple ids point to different tenants, refuse.
 * Returns { tenantId, source } on success, or { error } on conflict / missing.
 */
async function resolveDestinationTenant(req) {
  const candidates = [];

  if (isUuid(req.body.releaseId)) {
    const t = await resolveTenantForRelease(req.body.releaseId);
    if (t) candidates.push({ source: "releaseId", tenantId: t });
  }
  if (isUuid(req.body.trackId)) {
    const t = await resolveTenantForTrack(req.body.trackId);
    if (t) candidates.push({ source: "trackId", tenantId: t });
  }
  if (isUuid(req.body.labelId)) {
    const t = await resolveTenantForLabel(req.body.labelId);
    if (t) candidates.push({ source: "labelId", tenantId: t });
  }
  if (isUuid(req.body.artistId)) {
    const t = await resolveTenantForArtist(req.body.artistId);
    if (t) candidates.push({ source: "artistId", tenantId: t });
  }
  if (isUuid(req.body.entityId)) {
    // entityId on the BusinessEntity table is itself a tenant
    candidates.push({ source: "entityId", tenantId: req.body.entityId });
  }
  if (isUuid(req.body.tenantId)) {
    candidates.push({ source: "tenantId", tenantId: req.body.tenantId });
  }

  if (candidates.length === 0) {
    // Fall back to caller's own entityId when no body reference is present.
    if (req.uploadIsServerKey) return { tenantId: null, source: "none" };
    if (req.uploadEntityId) {
      return { tenantId: req.uploadEntityId, source: "caller" };
    }
    return { error: "ERROR_MISSING_TENANT_REFERENCE" };
  }

  const distinct = [...new Set(candidates.map((c) => c.tenantId))];
  if (distinct.length > 1) {
    return { error: "ERROR_CONFLICTING_TENANT_REFERENCES" };
  }
  return { tenantId: distinct[0], source: candidates[0].source };
}

/**
 * Combined resolve + verify. Returns { tenantId } on success or an error object.
 */
async function verifyAndResolveTenantFromBody(req) {
  const r = await resolveDestinationTenant(req);
  if (r.error) return r;
  if (!r.tenantId) {
    // Server key with no body reference — allowed.
    return { tenantId: null };
  }
  const ok = await isTenantAccessible(req, r.tenantId);
  if (!ok) return { error: "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" };
  return { tenantId: r.tenantId, source: r.source };
}

/**
 * Move req.file from the staging directory to the final destination.
 * Uses fs.renameSync when on the same volume, falls back to copy+unlink.
 * Updates req.file.path and req.file.destination so downstream code sees the move.
 */
function moveStagingFileTo(file, finalDir) {
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }
  const finalPath = path.join(finalDir, file.filename);
  try {
    fs.renameSync(file.path, finalPath);
  } catch (e) {
    // EXDEV: cross-device — fall back to copy + unlink.
    fs.copyFileSync(file.path, finalPath);
    fs.unlinkSync(file.path);
  }
  // Best-effort: prune the now-empty staging dir.
  try {
    fs.rmdirSync(path.dirname(file.path));
  } catch (e) { }
  file.path = finalPath;
  file.destination = finalDir;
  return finalPath;
}

const ZIP_U32_MAX = 0xffffffff;
const ZIP_U16_MAX = 0xffff;
const DDEX_EXPORT_ZIP_MAX_BYTES = Number.parseInt(
  process.env.DDEX_EXPORT_ZIP_MAX_BYTES || String(50 * 1024 * 1024 * 1024),
  10,
);
const DDEX_EXPORT_MAX_FILES = Number.parseInt(
  process.env.DDEX_EXPORT_MAX_FILES || "20000",
  10,
);
const DDEX_ARCHIVE_MAX_BYTES = Number.parseInt(
  process.env.DDEX_ARCHIVE_MAX_BYTES || String(50 * 1024 * 1024 * 1024),
  10,
);
const ZIP_EPOCH = new Date("1980-01-01T00:00:00Z").getTime();
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function dosDateTime(date) {
  const d = new Date(Math.max(date.getTime(), ZIP_EPOCH));
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    (Math.floor(d.getSeconds() / 2) & 0x1f);
  const day =
    ((year - 1980) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { time, day };
}

function crc32Buffer(buf, crc) {
  let c = crc ^ -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function writeUInt64LE(buf, value, offset) {
  buf.writeBigUInt64LE(BigInt(value), offset);
}

function zip64Extra(size, offset) {
  const includeOffset = offset !== undefined;
  const extra = Buffer.alloc(4 + 16 + (includeOffset ? 8 : 0));
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16 + (includeOffset ? 8 : 0), 2);
  writeUInt64LE(extra, size, 4);
  writeUInt64LE(extra, size, 12);
  if (includeOffset) writeUInt64LE(extra, offset, 20);
  return extra;
}

function zipLocalHeader(entry) {
  const name = Buffer.from(entry.name, "utf8");
  const extra = entry.needsZip64 ? zip64Extra(entry.size) : Buffer.alloc(0);
  const { time, day } = dosDateTime(entry.mtime);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(entry.needsZip64 ? 45 : 20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(entry.crc >>> 0, 14);
  header.writeUInt32LE(entry.needsZip64 ? ZIP_U32_MAX : Number(entry.size), 18);
  header.writeUInt32LE(entry.needsZip64 ? ZIP_U32_MAX : Number(entry.size), 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return Buffer.concat([header, name, extra]);
}

function zipCentralHeader(entry) {
  const name = Buffer.from(entry.name, "utf8");
  const needsOffset64 = entry.offset > BigInt(ZIP_U32_MAX);
  const extra = (entry.needsZip64 || needsOffset64)
    ? zip64Extra(entry.size, entry.offset)
    : Buffer.alloc(0);
  const { time, day } = dosDateTime(entry.mtime);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE((entry.needsZip64 || needsOffset64) ? 45 : 20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(entry.crc >>> 0, 16);
  header.writeUInt32LE(entry.needsZip64 ? ZIP_U32_MAX : Number(entry.size), 20);
  header.writeUInt32LE(entry.needsZip64 ? ZIP_U32_MAX : Number(entry.size), 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(needsOffset64 ? ZIP_U32_MAX : Number(entry.offset), 42);
  return Buffer.concat([header, name, extra]);
}

function zip64End(entries, centralSize, centralOffset) {
  const zip64 = Buffer.alloc(56);
  zip64.writeUInt32LE(0x06064b50, 0);
  writeUInt64LE(zip64, 44, 4);
  zip64.writeUInt16LE(45, 12);
  zip64.writeUInt16LE(45, 14);
  zip64.writeUInt32LE(0, 16);
  zip64.writeUInt32LE(0, 20);
  writeUInt64LE(zip64, entries.length, 24);
  writeUInt64LE(zip64, entries.length, 32);
  writeUInt64LE(zip64, centralSize, 40);
  writeUInt64LE(zip64, centralOffset, 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  writeUInt64LE(locator, centralOffset + centralSize, 8);
  locator.writeUInt32LE(1, 16);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Math.min(entries.length, ZIP_U16_MAX), 8);
  eocd.writeUInt16LE(Math.min(entries.length, ZIP_U16_MAX), 10);
  eocd.writeUInt32LE(centralSize > BigInt(ZIP_U32_MAX) ? ZIP_U32_MAX : Number(centralSize), 12);
  eocd.writeUInt32LE(centralOffset > BigInt(ZIP_U32_MAX) ? ZIP_U32_MAX : Number(centralOffset), 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([zip64, locator, eocd]);
}

function collectFilesUnder(rootDir, opts = {}) {
  const maxFiles = opts.maxFiles || Infinity;
  const maxBytes = BigInt(opts.maxBytes || Number.MAX_SAFE_INTEGER);
  const files = [];
  let totalBytes = 0n;
  let tooManyFiles = false;
  let tooLarge = false;

  function walk(dir) {
    if (tooManyFiles || tooLarge) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (tooManyFiles || tooLarge) return;
      if (!isSafeEntryName(ent.name)) continue;
      const abs = safeJoinUnder(dir, ent.name);
      if (!abs) continue;
      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(abs);
      } else if (stat.isFile()) {
        const rel = path.relative(rootDir, abs).replace(/\\/g, "/");
        if (files.length + 1 > maxFiles) {
          tooManyFiles = true;
          return;
        }
        totalBytes += BigInt(stat.size);
        if (totalBytes > maxBytes) {
          tooLarge = true;
          return;
        }
        files.push({ abs, name: rel, size: BigInt(stat.size), mtime: stat.mtime });
      }
    }
  }
  walk(rootDir);
  return { files, totalBytes, tooManyFiles, tooLarge };
}

async function hashZipEntry(abs) {
  return new Promise((resolve, reject) => {
    let crc = 0;
    const stream = fs.createReadStream(abs, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => {
      crc = crc32Buffer(chunk, crc);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(crc >>> 0));
  });
}

function writeResponse(res, chunk) {
  return new Promise((resolve, reject) => {
    if (res.write(chunk)) return resolve();
    res.once("drain", resolve);
    res.once("error", reject);
  });
}

async function pipeFileToResponse(res, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res, { end: false });
  });
}

/**
 * Multer storage that writes to a neutral staging directory keyed by caller +
 * a fresh UUID. Handlers must verify tenant ownership and move the file out
 * before they accept it.
 */
const stagingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // `caller` and `randomUUID` are server-derived and already constrained,
    // but route the join through safeJoinUnder so a future refactor that
    // accepts an attacker-controlled subpath here still cannot escape.
    const caller = req.uploadIsServerKey
      ? "server"
      : isUuid(req.uploadUserId)
        ? req.uploadUserId
        : "anon";
    const dir = safeJoinUnder(
      __dirname,
      "uploads",
      ".staging",
      caller,
      crypto.randomUUID(),
    );
    if (!dir) return cb(new Error("ERROR_INVALID_STAGING_PATH"));
    try {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    try {
      file.originalname = Buffer.from(file.originalname, "latin1").toString(
        "utf8",
      );
    } catch (e) { }
    cb(null, sanitizeFilename(file.originalname));
  },
});

/**
 * Cleanup the staging file when an upload is rejected post-multer.
 * Safe no-op if the file is already gone.
 */
function discardStagingFile(file) {
  if (!file?.path) return;
  try {
    fs.unlinkSync(file.path);
  } catch (e) { }
  try {
    fs.rmdirSync(path.dirname(file.path));
  } catch (e) { }
}

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

    // Check expiry (use <= so the exact expiry second is rejected).
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
    if (payload.exp > now + MAX_UPLOAD_TOKEN_TTL_SEC) return null;

    // Check purpose
    if (payload.purpose !== "upload") return null;

    return payload;
  } catch (e) {
    return null;
  }
}

function requireApiKey(req, res, next) {
  // Skip auth only in explicit development if no key is configured
  if (!UPLOAD_API_KEY && process.env.NODE_ENV === "development") {
    return next();
  }
  if (!UPLOAD_API_KEY) {
    return res
      .status(503)
      .json({ error: "ERROR_UPLOAD_SERVER_NOT_CONFIGURED_UPLOAD_API_KEY" });
  }

  // Method 1: Direct API key (server-to-server). SEC-H3: constant-time compare.
  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");
  if (apiKeyMatches(provided)) {
    // Server-to-server caller: trusted, all tenants accessible.
    req.uploadIsServerKey = true;
    req.uploadTenantIds = null;
    return next();
  }

  // Method 2: Signed upload token (browser-direct)
  const uploadToken = req.headers["x-upload-token"];
  if (uploadToken) {
    const payload = verifyUploadToken(uploadToken);
    if (payload) {
      req.uploadUserId = payload.sub; // Attach userId for audit
      // SEC-C1: tenant scope claims signed by dashboard at token issue time.
      // entityPath is the caller's position in the ltree-style tenant hierarchy;
      // anything not a descendant-or-self of entityPath must be refused.
      req.uploadEntityId = payload.entityId || null;
      req.uploadEntityPath = payload.entityPath || null;
      req.uploadEntityType = payload.entityType || null;
      req.uploadIsServerKey = false;
      return next();
    }
  }

  return res
    .status(401)
    .json({
      error: "ERROR_UNAUTHORIZED_INVALID_OR_MISSING_API_KEY_UPLO",
    });
}

// SEC-C1: Files land in a neutral staging directory and are only moved into the
// tenant-visible tree after `verifyAndResolveTenantFromBody` confirms access.
// The `storage` alias is preserved so existing multer wrappers continue to compile.
const storage = stagingStorage;

// SEC-C1: audio uploads also land in neutral staging — final path is built
// after tenant verification using server-resolved label/release ids.
const audioStorage = stagingStorage;

// SEC-M3: caps on field count + field size so a malicious multipart body
// can't blow up memory before we get to the request handler.
const MULTER_FIELD_CAPS = {
  fields: 60,         // body fields per request
  fieldNameSize: 200, // bytes for any field name
  fieldSize: 64 * 1024, // 64 KB per text field — well above any sane title / id
  files: 1,           // single file per upload route (we never expect more)
};

// For audio we do post-upload magic-header validation (do NOT rely on extension/mimetype)
const uploadAudioOriginal = multer({
  storage: audioStorage,
  limits: { fileSize: 500 * 1024 * 1024, ...MULTER_FIELD_CAPS }, // 500MB
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
    const { stdout } = await execMediaTool("ffprobe", [
      "-v", "error",
      "-show_entries",
      "stream=codec_name,codec_type,width,height,r_frame_rate,bit_rate,channels,sample_rate,field_order:format=duration",
      "-of", "json",
      filePath,
    ]);
    const probe = JSON.parse(stdout);
    const videoStream = probe.streams?.find((s) => s.codec_type === "video");
    const audioStream = probe.streams?.find((s) => s.codec_type === "audio");
    const duration = parseFloat(probe.format?.duration || 0);

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

    // C3: YouTube Shorts auto-block — VEVO rejects videos YouTube would auto-route to Shorts.
    // Trigger conditions: ≤180s AND aspect ≤1:1 (square or vertical-leaning).
    // Vertical already rejected above; this catches square/near-square uploads.
    if (duration > 0 && duration <= 180) {
      const aspect = width / height;
      if (aspect <= 1.05) {
        errors.push("ERROR_VEVO_YOUTUBE_SHORTS_AUTO_ROUTE");
        return errors;
      }
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
      const { stderr: qcLog } = await execMediaTool("ffmpeg", [
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

function runFfmpegCommand(command, resolve, reject, timeoutMs = FFMPEG_JOB_TIMEOUT_MS) {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { command.kill("SIGKILL"); } catch (_) {}
    reject(new Error("ERROR_MEDIA_PROCESSING_TIMEOUT"));
  }, timeoutMs);

  const finish = (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (err) reject(err);
    else resolve();
  };

  command.on("end", () => finish()).on("error", finish).run();
}

function generateHLS(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    // outputDir is a literal "hls" subdir joined to a fully-trusted destDir at
    // the call site (job worker), so path.join below is segment-safe.
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const chunkTemplate = safeJoinUnder(outputDir, "chunk_%03d.aac");
    const playlistPath = safeJoinUnder(outputDir, "playlist.m3u8");
    if (!chunkTemplate || !playlistPath) {
      return reject(new Error("ERROR_INVALID_HLS_PATH"));
    }

    const command = ffmpeg(inputPath)
      .outputOptions([
        "-c:a aac",
        "-b:a 128k",
        "-vn",
        "-f hls",
        "-hls_time 10",
        "-hls_list_size 0",
        `-hls_segment_filename ${chunkTemplate}`,
      ])
      .output(playlistPath);
    runFfmpegCommand(command, resolve, reject);
  });
}

function generatePeaks(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const peaks = [];
    let settled = false;
    const command = ffmpeg(inputPath).outputOptions([
      "-ac 1",
      "-filter:a aresample=100",
      "-map 0:a",
      "-c:a pcm_s16le",
      "-f data",
    ]);

    const timer = setTimeout(() => {
      finish(new Error("ERROR_MEDIA_PROCESSING_TIMEOUT"));
    }, FFMPEG_JOB_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      try { stream.removeAllListeners(); } catch (_) {}
      try { stream.destroy(); } catch (_) {}
      try { command.kill("SIGKILL"); } catch (_) {}
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err); else resolve();
    };

    const stream = command.pipe();

    stream.on("data", (chunk) => {
      // 16-bit signed little-endian PCM. Trim trailing half-sample to avoid
      // a RangeError from readInt16LE on an unaligned final chunk.
      const len = chunk.length - (chunk.length % 2);
      for (let i = 0; i < len; i += 2) {
        const val = chunk.readInt16LE(i);
        peaks.push(Number((val / 32768).toFixed(4)));
      }
    });
    stream.on("end", () => {
      try {
        fs.writeFileSync(outputPath, JSON.stringify(peaks));
        finish();
      } catch (err) {
        finish(err);
      }
    });
    stream.on("error", finish);
    command.on("error", finish);
  });
}

/**
 * Re-encode an Apple Digital Masters source (24-bit WAV/FLAC) to AAC
 * VBR ~256 kbps in an MP4 container. Apple's reference tool is afconvert
 * (-q 127 -s 2). Closest portable equivalents:
 *   1. libfdk_aac -vbr 5 — psychoacoustic VBR averaging ~256 kbps stereo.
 *   2. native aac -q:a 2 — fallback when ffmpeg lacks fdk_aac.
 * The native encoder's quality is lower, but it ships in every ffmpeg build
 * so delivery does not silently fail when the master is otherwise valid.
 */
function transcodeAdmAacVbr256(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const tryEncode = (codecArgs, label) => new Promise((res, rej) => {
      const command = ffmpeg(inputPath)
        .outputOptions([
          ...codecArgs,
          "-vn",
          "-movflags", "+faststart",
        ])
        .output(outputPath);
      runFfmpegCommand(command, () => res(label), rej);
    });

    tryEncode(["-c:a", "libfdk_aac", "-vbr", "5"], "libfdk_aac:vbr5")
      .then(resolve)
      .catch(() => {
        // libfdk_aac unavailable in this build — fall back to native VBR.
        tryEncode(["-c:a", "aac", "-q:a", "2"], "aac:q2")
          .then(resolve)
          .catch(reject);
      });
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

    const command = ffmpeg()
      .input(inputPath)
      .inputOptions([`-ss ${startSec}`])
      .outputOptions([
        `-t ${durationSec}`,
        "-c:a aac",
        "-b:a 128k",
        "-vn",
        "-movflags +faststart",
      ])
      .output(outputPath);
    runFfmpegCommand(command, resolve, reject);
  });
}

function generateVideoHLS(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const chunkTemplate = safeJoinUnder(outputDir, "chunk_%03d.ts");
    const playlistPath = safeJoinUnder(outputDir, "playlist.m3u8");
    if (!chunkTemplate || !playlistPath) {
      return reject(new Error("ERROR_INVALID_HLS_PATH"));
    }

    const command = ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 23",
        "-c:a aac",
        "-b:a 128k",
        "-f hls",
        "-hls_time 10",
        "-hls_list_size 0",
        `-hls_segment_filename ${chunkTemplate}`,
      ])
      .output(playlistPath);
    runFfmpegCommand(command, resolve, reject);
  });
}

function generateVideoPreviewSnippet(inputPath, outputPath, startSec = 0, durationSec = 30) {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const command = ffmpeg()
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
      .output(outputPath);
    runFfmpegCommand(command, resolve, reject);
  });
}

const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, ...MULTER_FIELD_CAPS }, // 10MB max for images
});

const uploadAudio = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, ...MULTER_FIELD_CAPS }, // 500MB max for audio
});

const uploadVideo = multer({
  storage,
  fileFilter: videoFilter,
  limits: { fileSize: 40 * 1024 * 1024 * 1024, ...MULTER_FIELD_CAPS }, // 40GB max for video (VEVO allows up to 128GB)
});

const uploadDocument = multer({
  storage,
  fileFilter: documentFilter,
  limits: { fileSize: 50 * 1024 * 1024, ...MULTER_FIELD_CAPS }, // 50MB max for documents
});

// Generic upload (any file type) with reasonable limit
const uploadGeneric = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, ...MULTER_FIELD_CAPS }, // 500MB max
});

const DDEX_IMPORT_PACKAGE_MAX_BYTES = Number.parseInt(
  process.env.DDEX_IMPORT_PACKAGE_MAX_BYTES || String(50 * 1024 * 1024 * 1024),
  10,
);

// DDEX album packages can contain many full-resolution WAV masters. Default cap: 50GB.
// Keep this route disk-spooled only; do not unzip or buffer package contents in-process.
const uploadDdexImportPackage = multer({
  storage,
  limits: {
    fileSize: DDEX_IMPORT_PACKAGE_MAX_BYTES,
    ...MULTER_FIELD_CAPS,
  },
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

app.post(
  "/upload/ddex-import-package",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadDdexImportPackage.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) {
        return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });
      }

      try {
        const originalName = sanitizeFilename(req.file.originalname || req.file.filename);
        if (path.extname(originalName).toLowerCase() !== ".zip") {
          discardStagingFile(req.file);
          return res.status(400).json({ error: "ERROR_DDEX_IMPORT_PACKAGE_MUST_BE_ZIP" });
        }

        const tenantCheck = await verifyAndResolveTenantFromBody(req);
        if (tenantCheck.error) {
          discardStagingFile(req.file);
          return res.status(403).json({ error: tenantCheck.error });
        }

        const ownerSeg = sanitizeFilename(tenantCheck.tenantId || req.uploadEntityId || "server");
        const packageId = crypto.randomUUID();
        const finalDir = safeJoinUnder(
          __dirname,
          "uploads",
          "ddex-imports",
          ownerSeg,
          packageId,
        );
        if (!finalDir) {
          discardStagingFile(req.file);
          return res.status(400).json({ error: "ERROR_INVALID_DDEX_IMPORT_PATH" });
        }

        req.file.filename = originalName;
        const finalPath = moveStagingFileTo(req.file, finalDir);
        const uploadsRoot = path.join(__dirname, "uploads");
        const storagePath = path.relative(uploadsRoot, finalPath).replace(/\\/g, "/");
        const stat = fs.statSync(finalPath);

        return res.status(201).json({
          success: true,
          packageId,
          fileName: originalName,
          sizeBytes: stat.size,
          storagePath,
          fileUrl: `/uploads/${storagePath}`,
          processingMode: "staged",
        });
      } catch (error) {
        discardStagingFile(req.file);
        console.error("[DDEX Import Package] upload error:", error && error.message ? error.message : error);
        return res.status(500).json({ error: "ERROR_DDEX_IMPORT_PACKAGE_UPLOAD_FAILED" });
      }
    });
  },
);

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

      // SEC-C1: refuse cross-tenant writes before the staged file moves anywhere.
      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
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

      const safeLabel = labelName || sanitizeFilename(req.body.labelId) || "Independent";
      const safeArtist = artistName || "Unknown Artist";
      const safeTrack =
        trackTitle ||
        sanitizeFilename(req.file.originalname.split(".")[0]) ||
        "Unknown Track";

      // Build path. Plan §148 layout if USE_TENANT_STORAGE_LAYOUT=true:
      //   uploads/{tenantId}/{ownerId}/releases/{releaseId}/audio/{Artist - Track}/
      // Legacy layout otherwise:
      //   uploads/audio/{Label}/{ReleaseId}/{Artist - Track}/
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");
      const trackFolder = `${safeArtist} - ${safeTrack}`;
      let folderParts;
      if (USE_TENANT_STORAGE_LAYOUT && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        const tenantParts = ownership
          ? buildTenantScopedFolderParts(
              "audio",
              ownership.tenantId,
              ownership.ownerId,
              releaseId,
              [trackFolder],
            )
          : null;
        folderParts = tenantParts || [
          "uploads",
          "audio",
          safeLabel,
          safeReleaseId,
          trackFolder,
        ];
      } else {
        folderParts = [
          "uploads",
          "audio",
          safeLabel,
          safeReleaseId,
          trackFolder,
        ];
      }

      const destDir = req.body.isTemp === "true" ? req.file.destination : safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

      // Xóa file cũ của track này nếu có (vì thư mục này chỉ dành cho 1 track)
      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          const files = fs.readdirSync(destDir);
          for (const f of files) {
            if (!isSafeEntryName(f)) continue;
            const filePath = safeJoinUnder(destDir, f);
            if (!filePath) continue;
            try {
              const st = fs.lstatSync(filePath);
              if (st.isSymbolicLink()) continue;
            } catch { continue; }
            if (filePath !== req.file.path) fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error("Failed to clean up old audio files in: %s %s", destDir, e && e.message);
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
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

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
        try {
          await enqueueMediaJob("process-audio", {
            inputPath: destPath,
            outputDir: destDir,
            peaksPath: path.join(destDir, "peaks.json"),
            previewPath: path.join(destDir, "preview.aac")
          });
        } catch (queueError) {
          try { fs.unlinkSync(destPath); } catch { }
          const status = queueError?.message === "ERROR_MEDIA_QUEUE_FULL" ? 503 : 500;
          return res.status(status).json({
            error: queueError?.message === "ERROR_MEDIA_QUEUE_FULL"
              ? "ERROR_MEDIA_PROCESSING_QUEUE_FULL"
              : "ERROR_MEDIA_PROCESSING_QUEUE_UNAVAILABLE",
          });
        }

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

      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
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

      const safeLabel = labelName || sanitizeFilename(req.body.labelId) || "Independent";
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

      // Plan §148: tenant-scoped layout for ADM masters.
      if (USE_TENANT_STORAGE_LAYOUT && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        if (ownership?.tenantId) {
          const scoped = buildTenantScopedFolderParts(
            "adm",
            ownership.tenantId,
            ownership.ownerId,
            releaseId,
            [trackFolder],
          );
          if (scoped) folderParts = scoped;
        }
      }

      const destDir = req.body.isTemp === "true" ? req.file.destination : safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          const files = fs.readdirSync(destDir);
          for (const f of files) {
            if (!isSafeEntryName(f)) continue;
            const filePath = safeJoinUnder(destDir, f);
            if (!filePath) continue;
            try {
              const st = fs.lstatSync(filePath);
              if (st.isSymbolicLink()) continue;
            } catch { continue; }
            if (filePath !== req.file.path) fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error("Failed to clean up old ADM files in: %s %s", destDir, e && e.message);
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
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

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

        // H3: ADM True Peak ceiling ≤ -1.0 dBFS (afclip equivalent via ffmpeg ebur128).
        // ffmpeg's `ebur128=peak=true` reports True Peak in dBTP per channel.
        let truePeakDb = null;
        try {
          const { stderr: tpLog } = await execMediaTool("ffmpeg", [
            "-i", destPath,
            "-af", "ebur128=peak=true",
            "-f", "null", "-",
          ]);
          // Parse "Peak:  -0.5 dBFS" or per-channel lines.
          const peakMatches = [...tpLog.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
          if (peakMatches.length > 0) {
            truePeakDb = Math.max(...peakMatches.map((m) => parseFloat(m[1])));
          }
        } catch (e) {
          console.warn("ADM true-peak probe failed:", e.message);
        }
        if (truePeakDb !== null && truePeakDb > -1.0) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_ADM_TRUE_PEAK_TOO_HOT",
            message: `Apple Digital Masters requires True Peak ≤ -1.0 dBFS. This file peaks at ${truePeakDb.toFixed(2)} dBFS. Attenuate the master limiter by at least ${(truePeakDb + 1.0).toFixed(2)} dB.`,
            truePeakDb: truePeakDb,
          });
        }

        // H4: Upsampling detection via spectral rolloff.
        // When a file claims a high-res sample rate (>=88.2 kHz) but its spectral
        // content cuts off well below the declared Nyquist, the audio was
        // resampled from a lower-rate source. Apple Digital Masters rejects this.
        let spectralRolloffHz = null;
        let upsamplingFlag = null;
        if (sampleRate >= 88200) {
          try {
            const nyquist = sampleRate / 2;
            const { stderr: ssLog } = await execMediaTool("ffmpeg", [
              "-i", destPath,
              "-ss", "10",
              "-t", "30",
              "-af", "aspectralstats=measure=rolloff,ametadata=mode=print:file=-",
              "-f", "null", "-",
            ]);
            // Parse "lavfi.aspectralstats.<ch>.rolloff=<hz>" lines (one per frame per channel).
            const rolloffMatches = [...ssLog.matchAll(/lavfi\.aspectralstats\.\d+\.rolloff=(-?\d+(?:\.\d+)?)/g)];
            const rolloffs = rolloffMatches
              .map((m) => parseFloat(m[1]))
              .filter((v) => Number.isFinite(v) && v > 0);
            if (rolloffs.length > 0) {
              rolloffs.sort((a, b) => a - b);
              // 90th percentile ignores quiet/silent frames that depress the average.
              spectralRolloffHz = rolloffs[Math.floor(rolloffs.length * 0.9)];
              // 44.1 kHz source padded to 96 kHz keeps energy below ~22.05 kHz
              // (~46% of new Nyquist). Threshold at 45% catches that case.
              if (spectralRolloffHz < nyquist * 0.45) {
                upsamplingFlag = "UPSAMPLED";
              }
            }
          } catch (e) {
            console.warn("ADM upsampling probe failed:", e.message);
          }
        }
        if (upsamplingFlag === "UPSAMPLED") {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_ADM_UPSAMPLED",
            message: `Apple Digital Masters rejects upsampled audio. File declared at ${(sampleRate / 1000).toFixed(1)} kHz but spectral content stops at ~${(spectralRolloffHz / 1000).toFixed(1)} kHz, indicating resampling from a lower-rate source. Submit the original master at its native sample rate.`,
            declaredSampleRate: sampleRate,
            spectralRolloffHz: Math.round(spectralRolloffHz),
          });
        }

        // M2: BWF ADM gapless tolerance + bext chunk presence.
        // Apple Digital Masters and Atmos/ADM workflows require:
        //   - Leading silence <= 100 ms (gapless album sequencing).
        //   - Trailing silence <= 2000 ms (natural decay only, no dead air).
        //   - bext chunk recommended for editorial provenance (advisory).
        let bextChunkPresent = null;
        let leadingSilenceMs = null;
        let trailingSilenceMs = null;
        try {
          // bext chunk check: peek first 64KB of WAV header (FLAC has no bext).
          if (validWav) {
            const fd = fs.openSync(destPath, "r");
            const headBuf = Buffer.alloc(65536);
            const bytesRead = fs.readSync(fd, headBuf, 0, 65536, 0);
            fs.closeSync(fd);
            bextChunkPresent = headBuf.slice(0, bytesRead).indexOf("bext") !== -1;
          }
        } catch (e) {
          console.warn("BWF bext check failed:", e.message);
        }
        try {
          // silencedetect: -60 dBFS threshold, 50 ms minimum to skip dither floor.
          const { stderr: silLog } = await execMediaTool("ffmpeg", [
            "-i", destPath,
            "-af", "silencedetect=noise=-60dB:duration=0.05",
            "-f", "null", "-",
          ]);
          const startMatches = [...silLog.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)]
            .map((m) => parseFloat(m[1]));
          const endMatches = [...silLog.matchAll(/silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?)/g)]
            .map((m) => ({ end: parseFloat(m[1]), dur: parseFloat(m[2]) }));
          // Leading silence: first detected silence begins at ~0.
          if (startMatches.length > 0 && startMatches[0] <= 0.001 && endMatches.length > 0) {
            leadingSilenceMs = Math.round(endMatches[0].dur * 1000);
          }
          // Trailing silence: last silence ends within 100 ms of file EOF.
          if (endMatches.length > 0) {
            const last = endMatches[endMatches.length - 1];
            if (duration - last.end < 0.1) {
              trailingSilenceMs = Math.round(last.dur * 1000);
            }
          }
        } catch (e) {
          console.warn("BWF silence probe failed:", e.message);
        }
        if (leadingSilenceMs !== null && leadingSilenceMs > 100) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_BWF_LEADING_SILENCE_TOO_LONG",
            message: `BWF/ADM master has ${leadingSilenceMs} ms of leading silence. Trim to ≤100 ms to ensure gapless album playback.`,
            leadingSilenceMs: leadingSilenceMs,
          });
        }
        if (trailingSilenceMs !== null && trailingSilenceMs > 2000) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_BWF_TRAILING_SILENCE_TOO_LONG",
            message: `BWF/ADM master has ${trailingSilenceMs} ms of trailing silence. Trim to ≤2000 ms to preserve natural decay without dead air.`,
            trailingSilenceMs: trailingSilenceMs,
          });
        }

        // Integrity hashes for the master. Write sidecar .md5/.sha256 so Apple
        // Transporter and any downstream verifier can confirm bytes-on-wire
        // without re-streaming the master.
        let masterHashes = null;
        try {
          masterHashes = await computeFileHashes(destPath);
          fs.writeFileSync(destPath + ".md5", masterHashes.md5 + "  " + path.basename(destPath) + "\n");
          fs.writeFileSync(destPath + ".sha256", masterHashes.sha256 + "  " + path.basename(destPath) + "\n");
        } catch (e) {
          console.warn("ADM master hash failed:", e.message);
        }

        // Apple delivery requires an AAC VBR ~256k aux file alongside the
        // 24-bit master. Generate beside the master so it ships in the same
        // /uploads/adm/.../ folder and can be referenced in the DDEX MEAD.
        const aacPath = destPath.replace(/\.(wav|flac)$/i, ".m4a");
        let aacUrl = null;
        let aacEncoder = null;
        try {
          aacEncoder = await transcodeAdmAacVbr256(destPath, aacPath);
          aacUrl = "/" + require("path").relative(__dirname, aacPath).split(require("path").sep).map(encodeURIComponent).join("/");
        } catch (e) {
          console.error("ADM AAC re-encode failed:", e.message || e);
          // Non-fatal: master is still saved. Aux file can be regenerated later.
          try { if (fs.existsSync(aacPath)) fs.unlinkSync(aacPath); } catch { }
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
          aacPreview: aacUrl
            ? { url: aacUrl, encoder: aacEncoder, codec: "AAC", profile: "LC", mode: "VBR", targetBitrateKbps: 256 }
            : null,
          integrity: masterHashes
            ? {
                md5: masterHashes.md5,
                sha256: masterHashes.sha256,
                sizeBytes: masterHashes.sizeBytes,
                md5Url: fileUrl + ".md5",
                sha256Url: fileUrl + ".sha256",
              }
            : null,
          admValidation: {
            is24bit: bitsPerSample >= 24,
            sampleRateValid: ADM_VALID_SAMPLE_RATES.includes(sampleRate),
            formatValid: true,
            truePeakDb: truePeakDb,
            truePeakPassed: truePeakDb === null || truePeakDb <= -1.0,
            spectralRolloffHz: spectralRolloffHz,
            upsamplingPassed: upsamplingFlag !== "UPSAMPLED",
            bextChunkPresent: bextChunkPresent,
            leadingSilenceMs: leadingSilenceMs,
            trailingSilenceMs: trailingSilenceMs,
            gaplessPassed:
              (leadingSilenceMs === null || leadingSilenceMs <= 100) &&
              (trailingSilenceMs === null || trailingSilenceMs <= 2000),
            aacReencoded: aacUrl !== null,
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

      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
      }

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

      const safeLabel = labelName || sanitizeFilename(req.body.labelId) || "Independent";
      const safeArtist = artistName || "Unknown Artist";
      const safeTrack = trackTitle || sanitizeFilename(req.file.originalname.split(".")[0]) || "Unknown Track";
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");
      const trackFolder = `${safeArtist} - ${safeTrack}`;

      let folderParts = ["uploads", "video", safeLabel, safeReleaseId, trackFolder];

      // Plan §148: tenant-scoped layout for music videos.
      if (USE_TENANT_STORAGE_LAYOUT && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        if (ownership?.tenantId) {
          const scoped = buildTenantScopedFolderParts(
            "video",
            ownership.tenantId,
            ownership.ownerId,
            releaseId,
            [trackFolder],
          );
          if (scoped) folderParts = scoped;
        }
      }

      const destDir = req.body.isTemp === "true" ? req.file.destination : safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          fs.readdirSync(destDir).forEach(f => {
            if (!isSafeEntryName(f)) return;
            const filePath = safeJoinUnder(destDir, f);
            if (!filePath) return;
            try {
              const st = fs.lstatSync(filePath);
              if (st.isSymbolicLink()) return;
            } catch { return; }
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
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

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
        try {
          await enqueueMediaJob("process-video", {
            inputPath: destPath,
            outputDir: destDir,
            previewPath: path.join(destDir, "preview.mp4")
          });
        } catch (queueError) {
          try { fs.unlinkSync(destPath); } catch { }
          const status = queueError?.message === "ERROR_MEDIA_QUEUE_FULL" ? 503 : 500;
          return res.status(status).json({
            error: queueError?.message === "ERROR_MEDIA_QUEUE_FULL"
              ? "ERROR_MEDIA_PROCESSING_QUEUE_FULL"
              : "ERROR_MEDIA_PROCESSING_QUEUE_UNAVAILABLE",
          });
        }

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

    const command = ffmpeg(inputPath)
      .outputOptions(outputOptions)
      .output(outputPath);
    runFfmpegCommand(command, resolve, reject);
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

      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
      }

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "canvas", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "canvas", crypto.randomUUID()];

      // Plan §148: tenant-scoped layout for Spotify Canvas.
      if (USE_TENANT_STORAGE_LAYOUT && req.body.isTemp !== "true" && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        if (ownership?.tenantId) {
          const scoped = buildTenantScopedFolderParts(
            "canvas",
            ownership.tenantId,
            ownership.ownerId,
            releaseId,
          );
          if (scoped) folderParts = scoped;
        }
      }

      const destDir = safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

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
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

        // Process Canvas: Strip audio, trim if needed
        await processVisualLoop(currentPath, destPath, true, duration);
        try { fs.unlinkSync(currentPath); } catch { } // Cleanup original

        // Spotify Canvas hard cap: 9 MB. Reject anything larger so the asset
        // never gets shipped and bounced at the platform side.
        const CANVAS_MAX_BYTES = 9 * 1024 * 1024;
        let processedSize = 0;
        try { processedSize = fs.statSync(destPath).size; } catch { }
        if (processedSize > CANVAS_MAX_BYTES) {
          try { fs.unlinkSync(destPath); } catch { }
          return res.status(400).json({
            error: "ERROR_CANVAS_FILE_TOO_LARGE_9MB",
            sizeBytes: processedSize,
            maxBytes: CANVAS_MAX_BYTES,
          });
        }

        // Advisory seamless-loop check: SSIM between first and last frame.
        // Soft-fail (warning in response, not a rejection) so artists can
        // iterate without total block, but Spotify flags hard cuts in QA.
        const loopCheck = await verifyCanvasSeamlessLoop(destPath, duration);

        let canvasHashes = null;
        try {
          canvasHashes = await computeFileHashes(destPath);
          fs.writeFileSync(destPath + ".md5", canvasHashes.md5 + "  " + path.basename(destPath) + "\n");
          fs.writeFileSync(destPath + ".sha256", canvasHashes.sha256 + "  " + path.basename(destPath) + "\n");
        } catch (e) {
          console.warn("Canvas hash failed:", e.message);
        }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: processedSize || req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"), // path relative to base url
          canvasValidation: {
            sizeBytes: processedSize,
            withinSizeLimit: processedSize <= CANVAS_MAX_BYTES,
            seamlessLoop: loopCheck,
          },
          integrity: canvasHashes
            ? {
                md5: canvasHashes.md5,
                sha256: canvasHashes.sha256,
                sizeBytes: canvasHashes.sizeBytes,
                md5Url: fileUrl + ".md5",
                sha256Url: fileUrl + ".sha256",
              }
            : null,
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

      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
      }

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "motion", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "motion", require('crypto').randomUUID()];

      // Plan §148: tenant-scoped layout for Apple Motion.
      if (USE_TENANT_STORAGE_LAYOUT && req.body.isTemp !== "true" && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        if (ownership?.tenantId) {
          const scoped = buildTenantScopedFolderParts(
            "motion",
            ownership.tenantId,
            ownership.ownerId,
            releaseId,
          );
          if (scoped) folderParts = scoped;
        }
      }

      const destDir = safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const currentPath = req.file.path;
      try {
        const header = await readFileHeader(currentPath, 12);
        if (!isVideoHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_MOTION_MUST_BE_A_VALID_MP4_MOV_FILE" });
        }

        // Apple Motion Art spec: portrait 3:4 or square 1:1 only. Anything else is
        // rejected here so the asset never ships to Apple delivery and gets bounced.
        const aspectCheck = await validateMotionAspect(currentPath);
        if (!aspectCheck.ok) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({
            error: "ERROR_MOTION_ASPECT_RATIO_MUST_BE_3_4_OR_1_1",
            details: aspectCheck,
          });
        }

        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".mp4";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        let motionHashes = null;
        try {
          motionHashes = await computeFileHashes(destPath);
          fs.writeFileSync(destPath + ".md5", motionHashes.md5 + "  " + path.basename(destPath) + "\n");
          fs.writeFileSync(destPath + ".sha256", motionHashes.sha256 + "  " + path.basename(destPath) + "\n");
        } catch (e) {
          console.warn("Motion hash failed:", e.message);
        }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\/g, "/"),
          aspect: aspectCheck.aspect,
          width: aspectCheck.width,
          height: aspectCheck.height,
          integrity: motionHashes
            ? {
                md5: motionHashes.md5,
                sha256: motionHashes.sha256,
                sizeBytes: motionHashes.sizeBytes,
                md5Url: fileUrl + ".md5",
                sha256Url: fileUrl + ".sha256",
              }
            : null,
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

      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
      }

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

      // Plan §148: tenant-scoped layout for TIDAL artwork.
      if (USE_TENANT_STORAGE_LAYOUT && req.body.isTemp !== "true" && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        if (ownership?.tenantId) {
          const scoped = buildTenantScopedFolderParts(
            "tidal-artwork",
            ownership.tenantId,
            ownership.ownerId,
            releaseId,
          );
          if (scoped) folderParts = scoped;
        }
      }

      const destDir = safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      try {
        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".png";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

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

      const tenantCheck = await verifyAndResolveTenantFromBody(req);
      if (tenantCheck.error) {
        discardStagingFile(req.file);
        return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400).json({ error: tenantCheck.error });
      }

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

      // Plan §148: tenant-scoped layout for Amazon artwork.
      if (USE_TENANT_STORAGE_LAYOUT && req.body.isTemp !== "true" && isUuid(releaseId)) {
        const ownership = await resolveOwnershipForRelease(releaseId);
        if (ownership?.tenantId) {
          const scoped = buildTenantScopedFolderParts(
            "amazon-artwork",
            ownership.tenantId,
            ownership.ownerId,
            releaseId,
          );
          if (scoped) folderParts = scoped;
        }
      }

      const destDir = safeJoinUnder(__dirname, ...folderParts);
      if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      try {
        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".png";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

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

app.get("/hls/status/*", requireStreamAuth, async (req, res) => {
  const requestPathRaw = req.params[0] || "";
  if (!validatePathSegments(requestPathRaw)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  if (!(await enforceStreamTenant(req, res, requestPathRaw))) return;

  const statusFile = safeJoinUnder(
    __dirname,
    "uploads",
    ...requestPathRaw.split(/[\\/]+/),
    "hls",
    ".status",
  );
  if (!statusFile) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(statusFile)) {
    // Check if playlist already exists (legacy files without .status)
    const playlistFile = safeJoinUnder(path.dirname(statusFile), "playlist.m3u8");
    if (playlistFile && fs.existsSync(playlistFile)) {
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
app.post("/preview/regenerate", requireApiKey, checkUploadConcurrency, async (req, res) => {
  const { storagePath, snippetStart, snippetDuration } = req.body;
  if (!storagePath || typeof storagePath !== "string") {
    return res.status(400).json({ error: "ERROR_STORAGEPATH_IS_REQUIRED" });
  }
  if (!validatePathSegments(storagePath)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  // SEC-H1: refuse preview regeneration on files outside the caller's tenant.
  if (!req.uploadIsServerKey) {
    const tid = await findTenantForStoragePath(storagePath);
    if (!tid) return res.status(404).json({ error: "ERROR_SOURCE_AUDIO_FILE_NOT_FOUND" });
    const ok = await isTenantAccessible(req, tid);
    if (!ok) return res.status(403).json({ error: "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" });
  }

  // Find the source audio file
  const baseDir = path.join(__dirname, "uploads");
  const segments = storagePath.split(/[\\/]+/).filter(Boolean);
  const sourceDir = safeJoinUnder(baseDir, ...segments.slice(0, -1));
  if (!sourceDir) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  // Find the audio file (last segment, may be encoded)
  const fileName = decodeURIComponent(segments[segments.length - 1] || "");
  if (!fileName || !validateFilenameSegment(fileName)) {
    return res.status(400).json({ error: "ERROR_INVALID_FILENAME" });
  }
  const sourcePath = safeJoinUnder(sourceDir, fileName);
  if (!sourcePath) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: "ERROR_SOURCE_AUDIO_FILE_NOT_FOUND" });
  }

  const hlsDir = safeJoinUnder(sourceDir, "hls");
  const previewFile = hlsDir ? safeJoinUnder(hlsDir, "preview.aac") : null;
  if (!hlsDir || !previewFile) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }
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
// DDEX ARCHIVE BUILDER
// Snapshots an approved release into uploads/ddex/<labelId>/<releaseId>/v<N>/
// Inputs (JSON): { labelId, releaseId, ernXml, sourcePaths: [{src, dest}] }
//   • labelId/releaseId/version are all sanitized + path-bounded
//   • ernXml is written as ern.xml under the version folder
//   • sourcePaths are resolved under uploads/ and copied into the version folder
//   • No outbound DSP delivery — local snapshot only
// Server-to-server only (requireApiKey enforces x-api-key from dashboard)
// ══════════════════════════════════════════════════════════
app.post("/internal/ddex-archive", requireApiKey, async (req, res) => {
  if (!req.uploadIsServerKey) {
    return res.status(403).json({ error: "ERROR_SERVER_KEY_REQUIRED" });
  }

  const { labelId, releaseId, ernXml, sourcePaths } = req.body || {};

  if (!labelId || typeof labelId !== "string" || !isSafeEntryName(labelId)) {
    return res.status(400).json({ error: "ERROR_INVALID_LABEL_ID" });
  }
  if (!releaseId || typeof releaseId !== "string" || !isSafeEntryName(releaseId)) {
    return res.status(400).json({ error: "ERROR_INVALID_RELEASE_ID" });
  }
  if (!ernXml || typeof ernXml !== "string" || ernXml.length === 0) {
    return res.status(400).json({ error: "ERROR_ERN_XML_REQUIRED" });
  }
  // Hard cap on ERN size — sane releases are well under 1MB.
  if (ernXml.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "ERROR_ERN_XML_TOO_LARGE" });
  }
  if (!Array.isArray(sourcePaths)) {
    return res.status(400).json({ error: "ERROR_SOURCE_PATHS_REQUIRED" });
  }
  if (sourcePaths.length > 500) {
    return res.status(413).json({ error: "ERROR_TOO_MANY_SOURCE_PATHS" });
  }

  const releaseDir = safeJoinUnder(__dirname, "uploads", "ddex", labelId, releaseId);
  if (!releaseDir) {
    return res.status(400).json({ error: "ERROR_INVALID_RELEASE_DIR" });
  }

  // Determine next version number by scanning existing v<N> children.
  let nextVersion = 1;
  try {
    if (fs.existsSync(releaseDir)) {
      const existing = fs.readdirSync(releaseDir)
        .filter(name => /^v\d+$/.test(name))
        .map(name => parseInt(name.slice(1), 10))
        .filter(n => Number.isFinite(n));
      if (existing.length > 0) nextVersion = Math.max(...existing) + 1;
    }
  } catch (e) {
    console.error("[DDEX-Archive] Failed to scan existing versions:", e && e.message);
  }

  const versionFolder = `v${nextVersion}`;
  const versionDir = safeJoinUnder(releaseDir, versionFolder);
  if (!versionDir) {
    return res.status(400).json({ error: "ERROR_INVALID_VERSION_DIR" });
  }

  try {
    fs.mkdirSync(versionDir, { recursive: true });

    const ernPath = safeJoinUnder(versionDir, "ern.xml");
    if (!ernPath) {
      return res.status(400).json({ error: "ERROR_INVALID_ERN_PATH" });
    }
    fs.writeFileSync(ernPath, ernXml, "utf8");

    const copied = [];
    const skipped = [];
    const uploadsRoot = path.join(__dirname, "uploads");
    const uploadsRootReal = fs.realpathSync(uploadsRoot);
    const uploadsRootRealWithSep = uploadsRootReal.endsWith(path.sep)
      ? uploadsRootReal
      : uploadsRootReal + path.sep;
    let copiedBytes = 0;

    for (const entry of sourcePaths) {
      if (!entry || typeof entry !== "object") {
        skipped.push({ reason: "ERROR_INVALID_ENTRY" });
        continue;
      }
      const { src, dest } = entry;
      if (!src || typeof src !== "string" || !validatePathSegments(src)) {
        skipped.push({ src, reason: "ERROR_INVALID_SRC" });
        continue;
      }
      // Default dest = basename of src; reject anything traversing.
      const destName = (typeof dest === "string" && dest) ? dest : path.basename(src);
      if (!destName || !isSafeEntryName(destName)) {
        skipped.push({ src, reason: "ERROR_INVALID_DEST" });
        continue;
      }

      const srcSegments = src.split(/[\\/]+/).filter(Boolean);
      const absSrc = safeJoinUnder(uploadsRoot, ...srcSegments);
      const absDest = safeJoinUnder(versionDir, destName);
      if (!absSrc || !absDest) {
        skipped.push({ src, reason: "ERROR_PATH_BOUNDS" });
        continue;
      }
      if (!fs.existsSync(absSrc)) {
        skipped.push({ src, reason: "ERROR_SOURCE_NOT_FOUND" });
        continue;
      }
      // Refuse symlinks and parent-symlink escapes. A symlinked directory
      // under uploads/ must not copy arbitrary host files into the archive.
      try {
        const st = fs.lstatSync(absSrc);
        if (st.isSymbolicLink()) {
          skipped.push({ src, reason: "ERROR_SYMLINK_REFUSED" });
          continue;
        }
        const realSrc = fs.realpathSync(absSrc);
        if (realSrc !== uploadsRootReal && !realSrc.startsWith(uploadsRootRealWithSep)) {
          skipped.push({ src, reason: "ERROR_REALPATH_OUTSIDE_UPLOADS" });
          continue;
        }
        const stat = fs.statSync(absSrc);
        if (!stat.isFile()) {
          skipped.push({ src, reason: "ERROR_SOURCE_NOT_FILE" });
          continue;
        }
        if (copiedBytes + stat.size > DDEX_ARCHIVE_MAX_BYTES) {
          return res.status(413).json({ error: "ERROR_DDEX_ARCHIVE_TOO_LARGE" });
        }
        copiedBytes += stat.size;
      } catch {
        skipped.push({ src, reason: "ERROR_STAT_FAILED" });
        continue;
      }

      try {
        fs.copyFileSync(absSrc, absDest);
        copied.push({ src, dest: destName });
      } catch (e) {
        skipped.push({ src, reason: `ERROR_COPY_FAILED: ${e.message || e}` });
      }
    }

    const archivePath = `ddex/${labelId}/${releaseId}/${versionFolder}`;
    return res.json({
      success: true,
      archivePath,
      version: nextVersion,
      generatedAt: new Date().toISOString(),
      copied,
      skipped,
    });
  } catch (e) {
    console.error("[DDEX-Archive] Failed:", e && e.message);
    return res.status(500).json({ error: "ERROR_DDEX_ARCHIVE_FAILED" });
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
// Short TTL for direct audio/video bytes — IDM browser-extension grab window.
// Long TTL for HLS manifests + segments because playback spans many minutes
// and manifest cannot be re-signed mid-playback without re-fetch.
const STREAM_TOKEN_TTL_SEC_SHORT = parseInt(process.env.STREAM_TOKEN_TTL_SEC || "300"); // 5 minutes
const STREAM_TOKEN_TTL_SEC_HLS   = parseInt(process.env.STREAM_TOKEN_TTL_SEC_HLS || "1800"); // 30 minutes
// Legacy alias preserved for any external callers still importing it.
const STREAM_TOKEN_TTL_SEC = STREAM_TOKEN_TTL_SEC_SHORT;

// Per-path TTL: HLS playlists/segments need the longer window; everything else
// (raw MP3 preview, canvas MP4, etc.) uses the short window so a captured URL
// expires before IDM can complete a manual paste-and-download.
function ttlForStreamPath(streamPath) {
  if (!streamPath || typeof streamPath !== "string") return STREAM_TOKEN_TTL_SEC_SHORT;
  const lower = streamPath.toLowerCase();
  if (lower.endsWith(".m3u8") || lower.endsWith(".ts") || lower.includes("/hls/")) {
    return STREAM_TOKEN_TTL_SEC_HLS;
  }
  return STREAM_TOKEN_TTL_SEC_SHORT;
}

// IDM Anti-Hijack: refuse known downloader User-Agent patterns at the edge.
// Trivially spoofable but raises the bar for casual IDM/wget/curl grabbing.
const DOWNLOADER_UA_PATTERNS = [
  /\bIDM\b/i,
  /Internet Download Manager/i,
  /\bIDA\b/i,
  /FlashGet/i,
  /\bwget\b/i,
  /\bcurl\b/i,
  /\baria2\b/i,
  /\baxel\b/i,
  /\bDownloadMaster\b/i,
  /\bMegaDownload/i,
  /\byoutube-dl\b/i,
  /\byt-dlp\b/i,
  /\bffmpeg\b/i,
  /\bGetRight\b/i,
  /\bFreeDownloadManager\b/i,
  /\bJDownloader\b/i,
];
function isDownloaderUserAgent(ua) {
  if (!ua || typeof ua !== "string") return false;
  return DOWNLOADER_UA_PATTERNS.some((re) => re.test(ua));
}

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;
function isValidIp(value) {
  if (!value || typeof value !== "string") return false;
  if (IPV4_RE.test(value)) {
    return value.split(".").every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    });
  }
  return IPV6_RE.test(value) && value.includes(":");
}

/**
 * Generate a signed stream token.
 * @param {string} streamPath - The path to the media (e.g. "audio/label/release/track/hls/playlist.m3u8")
 * @param {string} clientIp - Requester's IP address
 * @returns {{ token: string, expiresAt: number }}
 */
function getStreamSigningSecret() {
  if (UPLOAD_API_KEY) return UPLOAD_API_KEY;
  if (process.env.NODE_ENV !== "development") return null;
  return "dev-upload-key-NOT-FOR-PRODUCTION";
}

function generateStreamToken(streamPath, clientIp, ttlSec) {
  // Security audit fix H6: No fallback secret outside development
  const secret = getStreamSigningSecret();
  if (!secret) {
    throw new Error("[FATAL] Cannot generate stream tokens without UPLOAD_API_KEY outside development");
  }
  const effectiveTtl = typeof ttlSec === "number" && ttlSec > 0
    ? ttlSec
    : ttlForStreamPath(streamPath);
  const expiresAt = Math.floor(Date.now() / 1000) + effectiveTtl;
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
 * IP-binding comparison for stream tokens.
 *
 * Exact match is too strict for HLS playback on mobile: a single session
 * issues a manifest plus dozens of .ts segment fetches, and a user roaming
 * between WiFi and cellular (or behind carrier NAT) changes IP mid-session.
 * The old code papered over this by disabling the check entirely outside
 * production. We instead require same /24 (IPv4); cross-region replay still
 * fails. IPv6 stays exact-match — fewer users, NAT is rare.
 */
function ipsAllowedMatch(tokenIp, clientIp) {
  if (!tokenIp || !clientIp) return false;
  if (tokenIp === clientIp) return true;
  const isIPv4 = (ip) => ip.includes(".") && !ip.includes(":");
  if (isIPv4(tokenIp) && isIPv4(clientIp)) {
    const a = tokenIp.split(".");
    const b = clientIp.split(".");
    if (a.length === 4 && b.length === 4) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    }
  }
  return false;
}

/**
 * Verify a signed stream token.
 * @param {string} token - The signed token from query string ?s=
 * @param {string} clientIp - Current requester's IP
 * @returns {{ valid: boolean, path?: string, error?: string }}
 */
function verifyStreamToken(token, clientIp) {
  if (!token) return { valid: false, error: "missing_token" };
  // Security audit fix H6: No fallback secret outside development
  const secret = getStreamSigningSecret();
  if (!secret) {
    return { valid: false, error: "server_misconfigured" };
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
    const now = Math.floor(Date.now() / 1000);
    const maxStreamTokenTtl = Math.max(STREAM_TOKEN_TTL_SEC_SHORT, STREAM_TOKEN_TTL_SEC_HLS);
    if (!Number.isFinite(payload.exp)) {
      return { valid: false, error: "missing_expiry" };
    }
    if (payload.exp <= now) {
      return { valid: false, error: "expired" };
    }
    if (payload.exp > now + maxStreamTokenTtl) {
      return { valid: false, error: "expiry_too_long" };
    }
    // IP binding check. Previously gated on NODE_ENV === "production", which
    // meant a token leaked from staging/dev could be replayed by anyone. Now
    // enforced whenever the token carries an IP, using a /24 subnet match for
    // IPv4 so mobile roaming doesn't break HLS playback. Explicit opt-out via
    // STREAM_TOKEN_SKIP_IP_BIND for localhost-only test setups.
    const skipIpBind = process.env.STREAM_TOKEN_SKIP_IP_BIND === "true";
    if (!skipIpBind && payload.ip && !ipsAllowedMatch(payload.ip, clientIp)) {
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
app.post("/stream/sign", requireApiKey, async (req, res) => {
  const { paths } = req.body; // array of stream paths to sign
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "ERROR_PATHS_ARRAY_REQUIRED" });
  }
  if (paths.length > 20) {
    return res.status(400).json({ error: "ERROR_MAX_20_PATHS_PER_REQUEST" });
  }
  if (paths.some((p) => {
    if (typeof p !== "string") return true;
    const normalized = p.replace(/^\/+/, "").replace(/^uploads\//, "");
    return !normalized || normalized.length > 1024 || !validatePathSegments(normalized);
  })) {
    return res.status(400).json({ error: "ERROR_INVALID_STREAM_PATH" });
  }

  const rawIp = req.ip || req.connection.remoteAddress || "unknown";
  const clientIp = isValidIp(rawIp) ? rawIp : "unknown";

  // SEC-H1: server-key callers can sign anything. Browser callers must own the
  // tenant that owns each path — refuse otherwise.
  const signed = await Promise.all(
    paths.map(async (p) => {
      if (typeof p !== "string" || !p) return { path: p, error: "invalid" };
      if (!req.uploadIsServerKey) {
        const tid = await findTenantForStoragePath(p);
        if (!tid) return { path: p, error: "not_found" };
        const ok = await isTenantAccessible(req, tid);
        if (!ok) return { path: p, error: "forbidden" };
      }
      const { token, expiresAt } = generateStreamToken(p, clientIp);
      return { path: p, token, expiresAt };
    }),
  );

  res.json({ signed });
});

// ══════════════════════════════════════════════════════════
// STREAM AUTHENTICATION MIDDLEWARE
// Validates access via: signed stream token (query ?s=),
//   upload token, API key, or dashboard Referer (dev only)
// ══════════════════════════════════════════════════════════
function requireStreamAuth(req, res, next) {
  // IDM Anti-Hijack: block known downloader UAs before any auth check.
  // Browser-controlled UA is trusted here only as a friction-raiser — IDM
  // can spoof Firefox, but most users won't. Bypassable for server-key
  // callers (DDEX delivery, sandbox tests).
  if (process.env.NODE_ENV !== "test") {
    const ua = req.headers["user-agent"] || "";
    if (isDownloaderUserAgent(ua) && !apiKeyMatches(req.headers["x-api-key"])) {
      return res.status(403).json({ error: "ERROR_STREAM_DOWNLOADER_FORBIDDEN" });
    }
  }

  // Method 0: Signed stream token (IDM-proof, preferred)
  const signedToken = req.query?.s;
  if (signedToken) {
    const rawIp = req.ip || req.connection.remoteAddress || "unknown";
  const clientIp = isValidIp(rawIp) ? rawIp : "unknown";
    const result = verifyStreamToken(signedToken, clientIp);
    if (result.valid) {
      req._signedStreamPath = result.path; // store for optional path validation
      req.uploadIsServerKey = false;
      req._streamTokenPathBound = true;
      return next();
    }
    // If token present but invalid, reject immediately (don't fall through)
    return res.status(403).json({ error: `ERROR_STREAM_TOKEN_${result.error?.toUpperCase()}` });
  }

  // Method 1: API key (server-to-server). SEC-H3: constant-time compare.
  const apiKey = req.headers["x-api-key"];
  if (apiKeyMatches(apiKey)) {
    req.uploadIsServerKey = true;
    return next();
  }

  // Method 2: Upload token (browser with credentials).
  const uploadToken = req.headers["x-upload-token"] || req.query?.token;
  if (uploadToken) {
    const payload = verifyUploadToken(uploadToken);
    if (payload) {
      req.uploadUserId = payload.sub;
      req.uploadEntityId = payload.entityId || null;
      req.uploadEntityPath = payload.entityPath || null;
      req.uploadEntityType = payload.entityType || null;
      req.uploadIsServerKey = false;
      return next();
    }
  }

  // SEC-H4: Referer-based dev bypass removed. Referer is trivially forgeable
  // and the original block also exempted requests when UPLOAD_API_KEY was
  // unset, leaking dev defaults into accidentally-shipped configs.
  return res.status(403).json({ error: "ERROR_STREAM_ACCESS_DENIED_VALID_TOKEN_OR_API_KEY" });
}

/**
 * Enforce tenant access for a /stream/* handler given the requested storage path.
 * Returns true (access granted) or false (response already sent).
 *
 *   • Signed stream tokens are path-bound — caller can only fetch the exact path
 *     baked into the token, so no extra lookup is needed.
 *   • Server-key callers are trusted.
 *   • Upload-token callers must own the tenant that owns the resource.
 */
async function enforceStreamTenant(req, res, requestedRelPath) {
  if (req.uploadIsServerKey) return true;
  if (req._streamTokenPathBound) {
    // verifyStreamToken already enforced path equality if the token had `.p`.
    if (req._signedStreamPath && req._signedStreamPath !== requestedRelPath) {
      res.status(403).json({ error: "ERROR_STREAM_TOKEN_PATH_MISMATCH" });
      return false;
    }
    return true;
  }
  const tid = await findTenantForStoragePath(requestedRelPath);
  if (!tid) {
    res.status(404).end();
    return false;
  }
  const ok = await isTenantAccessible(req, tid);
  if (!ok) {
    res.status(403).json({ error: "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" });
    return false;
  }
  return true;
}

// Stream endpoint to bypass IDM (Internet Download Manager)
// Supports both old UUID format and new labelId/isrc/filename paths
// Usage: /stream/audio/:path (where path can be uuid, uuid.wav, or labelId/isrc/filename.wav)
app.get("/stream/audio/*", requireStreamAuth, async (req, res) => {
  const requestPathRaw = req.params[0] || ""; // everything after /stream/audio/
  const baseDir = path.join(__dirname, "uploads");

  let filePath = null;

  // If nested path provided (labelId/isrc/filename), validate each segment
  if (requestPathRaw.includes("/") || requestPathRaw.includes("\\\\")) {
    if (!validatePathSegments(requestPathRaw)) {
      return res.status(400).send("Invalid path");
    }
    const directPath = safeJoinUnder(
      baseDir,
      ...requestPathRaw.split(/[\\/]+/),
    );
    if (!directPath) {
      return res.status(400).send("Invalid path");
    }
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      filePath = directPath;
    }
  }

  // Fallback: old UUID format — try common audio extensions in uploads/audio/
  if (!filePath) {
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
      const tryP = safeJoinUnder(baseDir, "audio", uuid);
      if (tryP && fs.existsSync(tryP)) filePath = tryP;
    } else {
      for (const ext of audioExts) {
        const tryPath = safeJoinUnder(baseDir, "audio", `${uuid}${ext}`);
        if (tryPath && fs.existsSync(tryPath)) {
          filePath = tryPath;
          break;
        }
      }
    }
  }

  if (!filePath) {
    return res.status(404).send("File not found");
  }

  // SEC-H1: refuse cross-tenant audio fetch.
  const relPathForCheck = path.relative(baseDir, filePath).replace(/\\/g, "/");
  if (!(await enforceStreamTenant(req, res, relPathForCheck))) return;

  const filename = path.basename(filePath);
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filename).toLowerCase();

  // V-3: Block direct streaming of lossless masters before taking stream slots.
  if (ext === ".wav" || ext === ".flac") {
    return res
      .status(403)
      .json({
        error: "ERROR_DIRECT_ACCESS_TO_LOSSLESS_FILES_FORBIDDEN_USE_HLS",
      });
  }

  // Enforce concurrent stream limits using Redis counters
  const rawIp = req.ip || req.connection.remoteAddress || "unknown";
  const clientIp = isValidIp(rawIp) ? rawIp : "unknown";
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
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

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
      await cleanupStreamCounters(clientIp);
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }

    // Limit chunk size to prevent abusive large single-range requests (e.g., 100MB)
    const MAX_RANGE_BYTES = parseInt(
      process.env.MAX_RANGE_BYTES || "104857600",
    );
    if (end - start + 1 > MAX_RANGE_BYTES) {
      await cleanupStreamCounters(clientIp);
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
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
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
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
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

  if (!requestPathRaw || !validatePathSegments(requestPathRaw)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  const directPath = safeJoinUnder(
    baseDir,
    ...requestPathRaw.split(/[\\/]+/),
  );
  if (!directPath) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(directPath) || !fs.statSync(directPath).isFile()) {
    return res.status(404).json({ error: "ERROR_FILE_NOT_FOUND" });
  }

  // SEC-H1: refuse cross-tenant video fetch.
  const relPathForCheck = path.relative(baseDir, directPath).replace(/\\/g, "/");
  if (!(await enforceStreamTenant(req, res, relPathForCheck))) return;

  // Concurrent stream limits
  const rawIp = req.ip || req.connection.remoteAddress || "unknown";
  const clientIp = isValidIp(rawIp) ? rawIp : "unknown";
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
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");

  const encodedFilename = encodeURIComponent(filename);
  res.setHeader("Content-Disposition", `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader("Content-Type", contentType);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
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
      await cleanupStreamCounters(clientIp);
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }
    const MAX_RANGE_BYTES = parseInt(process.env.MAX_RANGE_BYTES || "104857600");
    if (end - start + 1 > MAX_RANGE_BYTES) {
      await cleanupStreamCounters(clientIp);
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

  if (!requestPathRaw || !validatePathSegments(requestPathRaw)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH" });
  }

  const directPath = safeJoinUnder(
    baseDir,
    ...requestPathRaw.split(/[\\/]+/),
  );
  if (!directPath) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  if (!fs.existsSync(directPath) || !fs.statSync(directPath).isFile()) {
    return res.status(404).json({ error: "ERROR_FILE_NOT_FOUND" });
  }

  // SEC-H1: refuse cross-tenant canvas fetch.
  const relPathForCheck = path.relative(baseDir, directPath).replace(/\\/g, "/");
  if (!(await enforceStreamTenant(req, res, relPathForCheck))) return;

  const filename = path.basename(directPath);
  const ext = path.extname(filename).toLowerCase();
  const stat = fs.statSync(directPath);
  const fileSize = stat.size;
  const MAX_CANVAS_STREAM_BYTES = parseInt(
    process.env.MAX_CANVAS_STREAM_BYTES || "104857600",
    10,
  );
  if (fileSize > MAX_CANVAS_STREAM_BYTES) {
    return res.status(413).json({ error: "ERROR_CANVAS_FILE_TOO_LARGE_TO_STREAM" });
  }

  const mimeMap = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
  const contentType = mimeMap[ext] || "video/mp4";
  const rawIp = req.ip || req.connection.remoteAddress || "unknown";
  const clientIp = isValidIp(rawIp) ? rawIp : "unknown";

  try {
    const acquired = await acquireStreamSlot(clientIp);
    if (!acquired) {
      return res.status(429).json({ error: "ERROR_TOO_MANY_CONCURRENT_STREAMS" });
    }
  } catch (e) {
    console.error("Stream counter error:", e.message);
  }

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await cleanupStreamCounters(clientIp);
  };

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Disposition", `inline; filename="canvas_${encodeURIComponent(filename)}"`);
  res.setHeader("Content-Type", contentType);

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || start < 0 || start >= fileSize || end < start || end >= fileSize) {
      await cleanup();
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }
    const chunksize = end - start + 1;
    if (chunksize > MAX_CANVAS_STREAM_BYTES) {
      await cleanup();
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }
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
    res.writeHead(200, { "Content-Length": fileSize, "Content-Type": contentType });
    const stream = fs.createReadStream(directPath);
    req.socket.setTimeout(parseInt(process.env.STREAM_SOCKET_TIMEOUT_MS || "30000"), () => { try { stream.destroy(); } catch { } });
    stream.on("close", cleanup); stream.on("end", cleanup); stream.on("error", cleanup);
    stream.pipe(res);
  }
});

// Delete endpoint — generic for any file inside uploads
app.delete("/file/*", requireApiKey, async (req, res) => {
  const subPath = req.params[0] || "";

  if (!validatePathSegments(subPath)) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_FORMAT" });
  }

  const filePath = safeJoinUnder(
    __dirname,
    "uploads",
    ...subPath.split(/[\\/]+/),
  );
  if (!filePath) {
    return res.status(400).json({ error: "ERROR_INVALID_PATH_BOUNDS" });
  }

  // SEC-H6: refuse deletes of files the caller does not own. Server-key callers
  // bypass; browser-token callers must match the file's tenant. Unknown paths
  // (not registered in any asset/release/label/artist table) are refused for
  // browser-token callers — prevents drive-by deletes of HLS/peak/preview side
  // files that aren't recorded in the DB.
  if (!req.uploadIsServerKey) {
    const tid = await findTenantForStoragePath(subPath);
    if (!tid) {
      return res.status(404).json({ error: "ERROR_FILE_NOT_FOUND" });
    }
    const ok = await isTenantAccessible(req, tid);
    if (!ok) {
      return res.status(403).json({ error: "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" });
    }
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
  const allowedMoveTypes = new Set([
    "audio",
    "avatars",
    "labels",
    "artists",
    "covers",
    "video",
    "documents",
    "restore",
  ]);
  if (!allowedMoveTypes.has(type)) {
    return res.status(400).json({ error: "ERROR_INVALID_UPLOAD_MOVE_TYPE" });
  }

  try {
    // Lấy relative path từ url. VD: http://localhost:3001/uploads/temp/audio/uuid/file.wav -> uploads/temp/audio/uuid/file.wav
    const urlObj = new URL(url, "http://upload.local");
    const pathname = decodeURIComponent(urlObj.pathname).replace(/^\//, "");

    const parts = pathname.split("/");
    if (parts.some((p) => p === ".." || p === ".")) {
      return res.status(400).json({ error: "ERROR_INVALID_PATH_SEGMENTS" });
    }

    // SEC-H5: only allow moves out of the neutral staging area (post-C1 refactor)
    // or the legacy temp tree. Reject anything else so a caller can't shuffle
    // someone else's live assets around.
    const isStaging = pathname.startsWith("uploads/.staging/");
    const isTemp    = pathname.startsWith("uploads/temp/");
    if (!isStaging && !isTemp) {
      return res
        .status(400)
        .json({ error: "ERROR_URL_DOES_NOT_POINT_TO_A_STAGED_FILE" });
    }

    // SEC-H5: browser callers may only move files from their own neutral
    // staging directory. Legacy uploads/temp is unowned and therefore reserved
    // for trusted server-key migration/finalization flows only.
    if (!req.uploadIsServerKey) {
      if (!isStaging) {
        return res.status(403).json({ error: "ERROR_FORBIDDEN_UNOWNED_TEMP_MOVE" });
      }
      const ownerSeg = parts[2]; // ".staging" is parts[1]
      if (!ownerSeg || ownerSeg !== req.uploadUserId) {
        return res.status(403).json({ error: "ERROR_FORBIDDEN_CROSS_USER_STAGING" });
      }
    }

    // SEC-H5: destination tenant must match the caller's tenant subtree.
    const tenantCheck = await verifyAndResolveTenantFromBody(req);
    if (tenantCheck.error) {
      return res.status(tenantCheck.error === "ERROR_FORBIDDEN_CROSS_TENANT_ACCESS" ? 403 : 400)
        .json({ error: tenantCheck.error });
    }

    const currentPath = safeJoinUnder(__dirname, ...parts);
    if (!currentPath) {
      return res.status(400).json({ error: "ERROR_INVALID_SOURCE_PATH" });
    }
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

    // Plan §148: when USE_TENANT_STORAGE_LAYOUT is on AND we have a real
    // releaseId UUID, switch release-bound asset types to the tenant-scoped
    // layout. Non-release types (avatars/labels/artists) keep the legacy
    // shape because they have no release context.
    let folderParts = [];
    let scopedOwnership = null;
    const releaseBoundTypes = new Set(["audio", "covers", "video", "documents"]);
    if (
      USE_TENANT_STORAGE_LAYOUT &&
      releaseBoundTypes.has(type) &&
      isUuid(req.body.releaseId)
    ) {
      scopedOwnership = await resolveOwnershipForRelease(req.body.releaseId);
    }

    if (type === "audio") {
      const safeTrack = sanitizeFilename(
        req.body.trackTitle || originalName?.split(".")[0] || "Unknown Track",
      );
      const trackFolder = `${safeArtist} - ${safeTrack}`;
      if (scopedOwnership?.tenantId) {
        folderParts = buildTenantScopedFolderParts(
          "audio",
          scopedOwnership.tenantId,
          scopedOwnership.ownerId,
          req.body.releaseId,
          [trackFolder],
        ) || ["uploads", "audio", safeLabel, safeReleaseId, trackFolder];
      } else {
        folderParts = ["uploads", "audio", safeLabel, safeReleaseId, trackFolder];
      }
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
      if (scopedOwnership?.tenantId) {
        folderParts = buildTenantScopedFolderParts(
          "cover_art",
          scopedOwnership.tenantId,
          scopedOwnership.ownerId,
          req.body.releaseId,
        ) || ["uploads", safeLabel, safeArtist, safeRelease, "artwork"];
      } else {
        folderParts = ["uploads", safeLabel, safeArtist, safeRelease, "artwork"];
      }
    } else if (type === "video") {
      if (scopedOwnership?.tenantId) {
        folderParts = buildTenantScopedFolderParts(
          "video",
          scopedOwnership.tenantId,
          scopedOwnership.ownerId,
          req.body.releaseId,
        ) || ["uploads", safeLabel, safeArtist, safeRelease, "video"];
      } else {
        folderParts = ["uploads", safeLabel, safeArtist, safeRelease, "video"];
      }
    } else if (type === "documents") {
      if (scopedOwnership?.tenantId) {
        folderParts = buildTenantScopedFolderParts(
          "documents",
          scopedOwnership.tenantId,
          scopedOwnership.ownerId,
          req.body.releaseId,
        ) || ["uploads", safeLabel, safeArtist, safeRelease, "documents"];
      } else {
        folderParts = [
          "uploads",
          safeLabel,
          safeArtist,
          safeRelease,
          "documents",
        ];
      }
    } else if (type === "restore") {
      // SEC-M2: restore packages must be scoped per tenant — the previous
      // single shared "uploads/restore" folder let any caller list/overwrite
      // another tenant's archive.
      const tenantSeg =
        sanitizeFilename(tenantCheck.tenantId || req.uploadEntityId || "shared");
      folderParts = ["uploads", "restore", tenantSeg];
    }

    const destDir = safeJoinUnder(__dirname, ...folderParts);
    if (!destDir) return res.status(400).json({ error: "ERROR_INVALID_DEST_PATH" });
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Xóa file cũ của track nếu là audio
    if (type === "audio" && fs.existsSync(destDir)) {
      try {
        const files = fs.readdirSync(destDir);
        for (const f of files) {
          if (!isSafeEntryName(f)) continue;
          const entry = safeJoinUnder(destDir, f);
          if (entry) fs.unlinkSync(entry);
        }
      } catch (e) {
        console.error("Failed to clean up old files in:", destDir, e);
      }
    }

    const safeFinalName = sanitizeFilename(finalName);
    const destPath = safeJoinUnder(destDir, safeFinalName);
    if (!destPath) return res.status(400).json({ error: "ERROR_INVALID_FINAL_NAME" });

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
      encodeURIComponent(safeFinalName),
    ];
    const fileUrl = `/${urlParts.join("/")}`;

    res.json({
      success: true,
      filename: safeFinalName,
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
  if (!req.uploadIsServerKey) {
    return res.status(403).json({ error: "ERROR_SERVER_KEY_REQUIRED" });
  }

  const { releaseId } = req.body;
  if (!releaseId) return res.status(400).json({ error: "ERROR_MISSING_RELEASEID" });
  if (typeof releaseId !== "string" || !isUuid(releaseId)) {
    return res.status(400).json({ error: "ERROR_INVALID_RELEASE_ID" });
  }

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
        const urlObj = new URL(fileUrl, "http://upload.local");
        const pathname = decodeURIComponent(urlObj.pathname).replace(/^\//, "");

        const parts = pathname.split("/");
        if (parts.some((p) => p === ".." || p === ".")) {
          console.warn("Invalid path segments in finalize-release:", pathname);
          return fileUrl;
        }

        const currentPath = safeJoinUnder(__dirname, ...parts);
        if (!currentPath || !fs.existsSync(currentPath)) return fileUrl;

        const finalName = sanitize(path.basename(currentPath));
        const destParts = [...baseDdexPathParts, subFolder];
        const destDir = safeJoinUnder(__dirname, ...destParts);
        if (!destDir) return fileUrl;

        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        if (subFolder === "cover_art" && fs.existsSync(destDir)) {
          try {
            const files = fs.readdirSync(destDir);
            for (const f of files) {
              if (!isSafeEntryName(f)) continue;
              const entry = safeJoinUnder(destDir, f);
              if (entry) fs.unlinkSync(entry);
            }
          } catch (e) { }
        }

        const destPath = safeJoinUnder(destDir, finalName);
        if (!destPath) return fileUrl;
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
      .json({ error: "ERROR_FAILED_TO_FINALIZE_RELEASE" });
  }
});

app.post("/upload/export/ddex", requireApiKey, async (req, res) => {
  if (!req.uploadIsServerKey) {
    return res.status(403).json({ error: "ERROR_SERVER_KEY_REQUIRED" });
  }

  const { releaseId, xml } = req.body;
  if (!releaseId || !xml)
    return res.status(400).json({ error: "ERROR_MISSING_RELEASEID_OR_XML" });
  if (typeof releaseId !== "string" || !isSafeEntryName(releaseId)) {
    return res.status(400).json({ error: "ERROR_INVALID_RELEASE_ID" });
  }
  if (typeof xml !== "string" || xml.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "ERROR_DDEX_XML_TOO_LARGE" });
  }

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

    const {
      files,
      totalBytes: rawPayloadBytes,
      tooManyFiles,
      tooLarge,
    } = collectFilesUnder(releaseDir, {
      maxFiles: DDEX_EXPORT_MAX_FILES,
      maxBytes: DDEX_EXPORT_ZIP_MAX_BYTES,
    });
    if (files.length === 0) {
      return res.status(400).json({ error: "ERROR_NO_FILES_TO_EXPORT" });
    }
    if (tooManyFiles) {
      return res.status(413).json({ error: "ERROR_TOO_MANY_FILES_TO_EXPORT" });
    }
    if (tooLarge || rawPayloadBytes > BigInt(DDEX_EXPORT_ZIP_MAX_BYTES)) {
      return res.status(413).json({ error: "ERROR_DDEX_EXPORT_TOO_LARGE" });
    }

    const entries = [];
    let offset = 0n;
    for (const file of files) {
      const crc = await hashZipEntry(file.abs);
      const needsZip64 = file.size > BigInt(ZIP_U32_MAX);
      const entry = { ...file, crc, needsZip64, offset };
      const localHeader = zipLocalHeader(entry);
      entry.localHeader = localHeader;
      offset += BigInt(localHeader.length) + file.size;
      entries.push(entry);
    }

    const centralHeaders = entries.map(zipCentralHeader);
    const centralOffset = offset;
    const centralSize = centralHeaders.reduce((sum, h) => sum + BigInt(h.length), 0n);
    const end = zip64End(entries, centralSize, centralOffset);
    const contentLength = centralOffset + centralSize + BigInt(end.length);
    if (contentLength > BigInt(DDEX_EXPORT_ZIP_MAX_BYTES)) {
      return res.status(413).json({ error: "ERROR_DDEX_EXPORT_TOO_LARGE" });
    }

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="DDEX_${releaseFolder}.zip"`,
      "Content-Length": contentLength.toString(),
      "Cache-Control": "no-store",
    });

    for (const entry of entries) {
      await writeResponse(res, entry.localHeader);
      await pipeFileToResponse(res, entry.abs);
    }
    for (const header of centralHeaders) {
      await writeResponse(res, header);
    }
    await writeResponse(res, end);
    res.end();
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
          if (!isSafeEntryName(f)) continue;
          const fullPath = safeJoinUnder(dir, f);
          if (!fullPath) continue;
          const stat = fs.lstatSync(fullPath);
          if (stat.isSymbolicLink()) continue;
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

// SEC-L1: final error handler. Maps known multer/limit conditions to specific
// codes, keeps internal error messages out of the response body, and ensures
// any partially-uploaded file in the staging tree is cleaned up.
app.use((err, req, res, next) => {
  if (req.file) {
    try { discardStagingFile(req.file); } catch (e) { }
  }
  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      try { discardStagingFile(f); } catch (e) { }
    }
  }

  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE:     "ERROR_FILE_TOO_LARGE_PLEASE_CHECK_THE_FILE_SIZE_LI",
      LIMIT_FIELD_KEY:     "ERROR_FIELD_NAME_TOO_LONG",
      LIMIT_FIELD_VALUE:   "ERROR_FIELD_VALUE_TOO_LONG",
      LIMIT_FIELD_COUNT:   "ERROR_TOO_MANY_FIELDS",
      LIMIT_FILE_COUNT:    "ERROR_TOO_MANY_FILES",
      LIMIT_UNEXPECTED_FILE: "ERROR_UNEXPECTED_FILE_FIELD",
      LIMIT_PART_COUNT:    "ERROR_TOO_MANY_PARTS",
    };
    const code = map[err.code] || "ERROR_UPLOAD_PROCESSING_ERROR";
    console.error("[Multer]", err.code, err.field || "");
    return res.status(400).json({ error: code });
  }

  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "ERROR_REQUEST_BODY_TOO_LARGE" });
  }

  // CORS rejection from the cors() middleware bubbles up as a generic Error.
  if (err && /CORS/i.test(err.message || "")) {
    return res.status(403).json({ error: "ERROR_ORIGIN_NOT_ALLOWED" });
  }

  // Any other error: log internally, return generic code.
  console.error("[Unhandled]", err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
});

const server = app.listen(PORT, () => {
  console.log(`Upload server running at http://localhost:${PORT}`);
  console.log(`Uploads available at http://localhost:${PORT}/uploads`);
});

server.headersTimeout = Number.parseInt(process.env.HTTP_HEADERS_TIMEOUT_MS || "15000", 10);
server.keepAliveTimeout = Number.parseInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || "5000", 10);
server.requestTimeout = Number.parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || String(6 * 60 * 60 * 1000), 10);

