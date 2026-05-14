/**
 * Copyright Detection Module
 *
 * Scans uploaded audio files against AudD Music Recognition API
 * and optionally Pex Attribution Engine to detect copyrighted content.
 *
 * Reject rules:
 *   - Track duration <= 30s: reject if 100% copyrighted
 *   - Track duration >  30s: reject if >= 60s copyrighted
 *   - Below threshold but non-zero: WARNING for admin review
 *
 * Caching: SHA256(file) → Redis (24h TTL), namespaced by tenantId (Fix #4)
 * Fallback: If API fails/unconfigured → status "unchecked", upload proceeds
 *
 * !! AGPL WARNING (Fix #1) !!
 * If Panako is ever integrated as a self-hosted fingerprint engine,
 * it is AGPL-3.0 licensed. AGPL requires ALL source code served over
 * a network to be published. To avoid AGPL contamination:
 *   - Deploy Panako in an ISOLATED Docker container with a clean API boundary.
 *   - Never link Panako code directly into this Node.js process.
 *   - Get legal review before any SaaS deployment.
 *
 * !! LMDB SINGLE-WRITER (Fix #5) !!
 * If switching to Panako (which uses LMDB), note that LMDB is single-writer.
 * All `panako store` commands MUST go through a dedicated BullMQ queue
 * with concurrency: 1 to prevent B-tree corruption.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(execFile);

// ── Configuration ────────────────────────────────────────

const AUDD_API_URL = "https://api.audd.io/";
const AUDD_ENTERPRISE_URL = "https://enterprise.audd.io/";
const CHUNK_DURATION_SEC = 12; // AudD optimal: 5-12s
const CHUNK_OVERLAP_SEC = 2; // Overlap for better detection
const MAX_CHUNKS_TO_SCAN = 30; // Cap to avoid excessive API calls
const CACHE_TTL_SEC = 86400; // 24 hours
const AUDD_RATE_LIMIT_MS = 500; // 2 req/s max
const AUDD_DAILY_QUOTA = parseInt(process.env.AUDD_DAILY_QUOTA || "250"); // Fix #10: circuit breaker threshold
const AUDD_QUOTA_WARN_PCT = 0.8; // Warn admin at 80% usage

// ── Types (JSDoc) ────────────────────────────────────────

/**
 * @typedef {Object} CopyrightMatch
 * @property {number} chunkIndex
 * @property {number} startTime - seconds
 * @property {number} endTime - seconds
 * @property {string} title
 * @property {string} artist
 * @property {string} [album]
 * @property {string} [label]
 * @property {string} [isrc]
 * @property {string} source - 'audd' | 'pex'
 * @property {number} confidence - 0-100
 */

/**
 * @typedef {Object} CopyrightResult
 * @property {'clean'|'warning'|'rejected'|'unchecked'} status
 * @property {number} totalCopyrightedSeconds
 * @property {number} trackDuration
 * @property {CopyrightMatch[]} matches
 * @property {string} [reason]
 */

// ── Helpers ──────────────────────────────────────────────

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split audio into chunks using ffmpeg.
 * Returns array of temp file paths.
 */
async function splitAudioIntoChunks(filePath, duration, tempDir) {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const effectiveChunkDuration = CHUNK_DURATION_SEC;
  const step = effectiveChunkDuration - CHUNK_OVERLAP_SEC;
  const chunks = [];
  let offset = 0;

  while (offset < duration && chunks.length < MAX_CHUNKS_TO_SCAN) {
    const chunkEnd = Math.min(offset + effectiveChunkDuration, duration);
    const chunkPath = path.join(tempDir, `chunk_${chunks.length}.mp3`);

    try {
      // Fix #12: CPU isolation — use nice (lowest priority) + limit threads
      const isWin = process.platform === "win32";
      const ffmpegBin = isWin ? "ffmpeg" : "nice";
      const ffmpegArgs = isWin ? [] : ["-n", "19", "ffmpeg"];
      await execFileAsync(ffmpegBin, [
        ...ffmpegArgs,
        "-y",
        "-threads", "2",
        "-i", filePath,
        "-ss", String(offset),
        "-t", String(chunkEnd - offset),
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "64k",
        "-f", "mp3",
        chunkPath,
      ], { timeout: 30000 });

      if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 100) {
        chunks.push({
          path: chunkPath,
          startTime: offset,
          endTime: chunkEnd,
          index: chunks.length,
        });
      }
    } catch (err) {
      console.error(`[Copyright] FFmpeg chunk error at offset ${offset}:`, err.message);
    }

    offset += step;
  }

  return chunks;
}

/**
 * Send a single chunk to AudD API for recognition.
 * Returns match data or null.
 */
async function queryAudD(chunkPath, apiToken) {
  // Use dynamic import for node-fetch (ESM module)
  let fetchFn;
  try {
    fetchFn = globalThis.fetch || (await import("node-fetch")).default;
  } catch {
    // Fallback: use built-in https module
    return await queryAudDNative(chunkPath, apiToken);
  }

  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("api_token", apiToken);
  form.append("file", fs.createReadStream(chunkPath));
  form.append("return", "apple_music,spotify");

  try {
    const response = await fetchFn(AUDD_API_URL, {
      method: "POST",
      body: form,
      headers: form.getHeaders ? form.getHeaders() : {},
      timeout: 30000,
    });

    const data = await response.json();

    if (data.status === "error") {
      // Error codes: 901 = quota exceeded, 900 = invalid token
      if (data.error && (data.error.error_code === 901 || data.error.error_code === 900)) {
        console.warn(`[Copyright] AudD API error: ${data.error.error_message}`);
        return { error: data.error.error_code };
      }
      return null;
    }

    if (data.status === "success" && data.result) {
      return {
        title: data.result.title || "Unknown",
        artist: data.result.artist || "Unknown",
        album: data.result.album || null,
        label: data.result.label || null,
        isrc: data.result.isrc || null,
        releaseDate: data.result.release_date || null,
        confidence: data.result.score ? Math.round(data.result.score * 100) : 85,
        source: "audd",
      };
    }

    return null; // No match
  } catch (err) {
    console.error("[Copyright] AudD request failed:", err.message);
    return null;
  }
}

/**
 * Native HTTPS fallback for AudD (no node-fetch dependency).
 */
function queryAudDNative(chunkPath, apiToken) {
  return new Promise((resolve) => {
    const https = require("https");
    const FormData = require("form-data");
    const form = new FormData();
    form.append("api_token", apiToken);
    form.append("file", fs.createReadStream(chunkPath));
    form.append("return", "apple_music,spotify");

    const options = {
      method: "POST",
      hostname: "api.audd.io",
      path: "/",
      headers: form.getHeaders(),
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.status === "error") {
            if (data.error && (data.error.error_code === 901 || data.error.error_code === 900)) {
              console.warn(`[Copyright] AudD error: ${data.error.error_message}`);
              resolve({ error: data.error.error_code });
              return;
            }
            resolve(null);
            return;
          }
          if (data.status === "success" && data.result) {
            resolve({
              title: data.result.title || "Unknown",
              artist: data.result.artist || "Unknown",
              album: data.result.album || null,
              label: data.result.label || null,
              isrc: data.result.isrc || null,
              releaseDate: data.result.release_date || null,
              confidence: data.result.score ? Math.round(data.result.score * 100) : 85,
              source: "audd",
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          console.error("[Copyright] AudD parse error:", e.message);
          resolve(null);
        }
      });
    });

    req.on("error", (err) => {
      console.error("[Copyright] AudD native request error:", err.message);
      resolve(null);
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });

    form.pipe(req);
  });
}

/**
 * Cleanup temp chunk files.
 */
function cleanupChunks(tempDir) {
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(tempDir, f)); } catch {}
      }
      try { fs.rmdirSync(tempDir); } catch {}
    }
  } catch {}
}

// ── Main Export ──────────────────────────────────────────

/**
 * Check an audio file for copyright violations.
 *
 * @param {string} filePath - Absolute path to audio file
 * @param {number} duration - Track duration in seconds
 * @param {object} [redis] - Redis client instance (optional, for caching)
 * @param {string} [tenantId] - Tenant/label ID for cache isolation (Fix #4)
 * @returns {Promise<CopyrightResult>}
 */
async function checkCopyright(filePath, duration, redis, tenantId) {
  const auddToken = process.env.AUDD_API_TOKEN;
  const enabled = process.env.COPYRIGHT_CHECK_ENABLED !== "false";
  const safeTenant = tenantId || "global"; // Fix #4: namespace isolation

  // Guard: disabled or no token
  if (!enabled) {
    console.log("[Copyright] Check disabled via COPYRIGHT_CHECK_ENABLED=false");
    return {
      status: "unchecked",
      totalCopyrightedSeconds: 0,
      trackDuration: duration,
      matches: [],
      reason: "Copyright check disabled",
    };
  }

  if (!auddToken) {
    console.warn("[Copyright] No AUDD_API_TOKEN configured — skipping check");
    return {
      status: "unchecked",
      totalCopyrightedSeconds: 0,
      trackDuration: duration,
      matches: [],
      reason: "No API token configured",
    };
  }

  // Fix #10: AudD daily quota circuit breaker
  if (redis) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const quotaKey = `audd:daily:${today}`;
      const used = parseInt(await redis.get(quotaKey) || "0");
      if (used >= AUDD_DAILY_QUOTA) {
        console.warn(`[Copyright] AudD daily quota exhausted (${used}/${AUDD_DAILY_QUOTA}). Skipping scan.`);
        return {
          status: "unchecked",
          totalCopyrightedSeconds: 0,
          trackDuration: duration,
          matches: [],
          reason: `AudD daily quota exhausted (${used}/${AUDD_DAILY_QUOTA})`,
        };
      }
      if (used >= Math.floor(AUDD_DAILY_QUOTA * AUDD_QUOTA_WARN_PCT)) {
        console.warn(`[Copyright] AudD quota warning: ${used}/${AUDD_DAILY_QUOTA} (${Math.round(used/AUDD_DAILY_QUOTA*100)}% used)`);
      }
    } catch (e) {
      console.warn("[Copyright] Quota check failed:", e.message);
    }
  }

  // Check Redis cache
  let fileHash;
  try {
    fileHash = await sha256File(filePath);
    if (redis) {
      try {
        // Fix #4: tenant-namespaced cache key prevents cross-tenant metadata leaks
        const cacheKey = `copyright:${safeTenant}:${fileHash}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
          console.log(`[Copyright] Cache hit for ${safeTenant}:${fileHash.slice(0, 12)}...`);
          return JSON.parse(cached);
        }
      } catch (e) {
        console.warn("[Copyright] Redis cache read error:", e.message);
      }
    }
  } catch (e) {
    console.error("[Copyright] Hash error:", e.message);
    fileHash = null;
  }

  console.log(`[Copyright] Scanning ${path.basename(filePath)} (${Math.round(duration)}s)...`);

  // Split into chunks
  const tempDir = path.join(
    path.dirname(filePath),
    `.copyright_check_${Date.now()}`
  );

  let chunks = [];
  try {
    chunks = await splitAudioIntoChunks(filePath, duration, tempDir);
  } catch (err) {
    console.error("[Copyright] Chunking failed:", err.message);
    cleanupChunks(tempDir);
    return {
      status: "unchecked",
      totalCopyrightedSeconds: 0,
      trackDuration: duration,
      matches: [],
      reason: "Failed to split audio for analysis",
    };
  }

  if (chunks.length === 0) {
    cleanupChunks(tempDir);
    return {
      status: "unchecked",
      totalCopyrightedSeconds: 0,
      trackDuration: duration,
      matches: [],
      reason: "No audio chunks generated",
    };
  }

  // Query AudD for each chunk (rate-limited sequential)
  const matches = [];
  let quotaExhausted = false;
  let apiCallCount = 0;

  for (const chunk of chunks) {
    if (quotaExhausted) break;

    const result = await queryAudD(chunk.path, auddToken);
    apiCallCount++;

    if (result && result.error) {
      // API quota exhausted or invalid token
      quotaExhausted = true;
      console.warn("[Copyright] AudD quota exhausted, stopping scan");
      break;
    }

    if (result && !result.error) {
      matches.push({
        chunkIndex: chunk.index,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        title: result.title,
        artist: result.artist,
        album: result.album,
        label: result.label,
        isrc: result.isrc,
        source: result.source,
        confidence: result.confidence,
      });
    }

    // Rate limit: wait between requests
    await sleep(AUDD_RATE_LIMIT_MS);
  }

  // Fix #10: Increment daily quota counter
  if (redis && apiCallCount > 0) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const quotaKey = `audd:daily:${today}`;
      await redis.incrby(quotaKey, apiCallCount);
      await redis.expire(quotaKey, 86400 + 3600); // TTL: 25h (buffer)
    } catch (e) {
      console.warn("[Copyright] Quota counter update failed:", e.message);
    }
  }

  // Cleanup temp files
  cleanupChunks(tempDir);

  // If quota exhausted before completing scan, mark as unchecked
  if (quotaExhausted && matches.length === 0) {
    return {
      status: "unchecked",
      totalCopyrightedSeconds: 0,
      trackDuration: duration,
      matches: [],
      reason: "AudD API quota exhausted",
    };
  }

  // Calculate total copyrighted time (merge overlapping intervals)
  const copyrightedSeconds = calculateCopyrightedDuration(matches);

  // Apply reject rules
  const result = applyRejectRules(duration, copyrightedSeconds, matches);

  // Cache result (Fix #4: tenant-namespaced key)
  if (redis && fileHash) {
    try {
      await redis.setex(
        `copyright:${safeTenant}:${fileHash}`,
        CACHE_TTL_SEC,
        JSON.stringify(result)
      );
    } catch (e) {
      console.warn("[Copyright] Redis cache write error:", e.message);
    }
  }

  console.log(
    `[Copyright] Result: ${result.status} (${copyrightedSeconds}s/${Math.round(duration)}s copyrighted, ${matches.length} matches)`
  );

  return result;
}

/**
 * Merge overlapping intervals and calculate total copyrighted duration.
 */
function calculateCopyrightedDuration(matches) {
  if (matches.length === 0) return 0;

  // Sort by start time
  const intervals = matches
    .map((m) => ({ start: m.startTime, end: m.endTime }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end);
    } else {
      merged.push({ ...intervals[i] });
    }
  }

  // Sum durations
  return merged.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
}

/**
 * Apply copyright rejection rules:
 *   - duration <= 30s & 100% copyrighted → rejected
 *   - duration > 30s & copyrighted >= 60s → rejected
 *   - duration > 30s & copyrighted >= 60s (entire track) → rejected
 *   - Non-zero but below threshold → warning
 *   - Zero → clean
 */
function applyRejectRules(duration, copyrightedSeconds, matches) {
  const base = {
    totalCopyrightedSeconds: copyrightedSeconds,
    trackDuration: Math.round(duration),
    matches,
  };

  // No matches → clean
  if (copyrightedSeconds === 0) {
    return { ...base, status: "clean" };
  }

  // Short tracks (≤ 30s): reject only if 100% copyrighted
  if (duration <= 30) {
    if (copyrightedSeconds >= duration) {
      return {
        ...base,
        status: "rejected",
        reason: `Track is ${Math.round(duration)}s and 100% copyrighted`,
      };
    }
    // Partial match on short track → warning
    return {
      ...base,
      status: "warning",
      reason: `${copyrightedSeconds}s of ${Math.round(duration)}s matched copyrighted content`,
    };
  }

  // Long tracks (> 30s): reject if ≥ 60s copyrighted
  if (copyrightedSeconds >= 60) {
    return {
      ...base,
      status: "rejected",
      reason: `${copyrightedSeconds}s of copyrighted content detected (threshold: 60s)`,
    };
  }

  // Below threshold → warning for admin review
  return {
    ...base,
    status: "warning",
    reason: `${copyrightedSeconds}s of ${Math.round(duration)}s matched copyrighted content (below 60s threshold)`,
  };
}

// ── Rate Limiter Utility (Fix #13) ───────────────────────
// For future MusicBrainz integration: enforce 1 req/sec globally.
// Usage: await musicBrainzLimiter(); then fetch.

let _lastMBCall = 0;
async function musicBrainzLimiter() {
  const now = Date.now();
  const elapsed = now - _lastMBCall;
  if (elapsed < 1000) {
    await sleep(1000 - elapsed);
  }
  _lastMBCall = Date.now();
}

module.exports = {
  checkCopyright,
  calculateCopyrightedDuration,
  applyRejectRules,
  musicBrainzLimiter,
};
