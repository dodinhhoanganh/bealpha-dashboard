/**
 * Path traversal guard. Use everywhere we accept a path-shaped value from
 * a ZIP entry, DB column, URL parameter, multipart upload, or any other
 * non-literal source.
 *
 * Resolves the joined path under rootDir and returns the absolute path
 * only if it stays inside the root. Returns null if the input tries to
 * escape via `..`, absolute segments, or empty/invalid segments.
 */
const path = require("path");

function safeJoinUnder(rootDir, ...segments) {
  if (!rootDir || typeof rootDir !== "string") return null;
  for (const s of segments) {
    if (typeof s !== "string" || s.length === 0) return null;
    if (path.isAbsolute(s)) return null;
    if (s.includes("\0")) return null;
  }
  const root = path.resolve(rootDir);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const joined = path.resolve(root, ...segments);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (joined !== root && !joined.startsWith(rootWithSep)) return null;
  return joined;
}

/**
 * Validate that a single filesystem entry name is safe to use as a path
 * segment — no slashes, no `..`, no NUL. Use when iterating fs.readdir
 * results inside a trusted root.
 */
function isSafeEntryName(name) {
  if (!name || typeof name !== "string") return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  return true;
}

module.exports = { safeJoinUnder, isSafeEntryName };
