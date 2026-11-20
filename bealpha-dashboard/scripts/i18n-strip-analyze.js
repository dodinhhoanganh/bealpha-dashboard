/**
 * i18n analyzer (dry run): find all two-arg t("key","English fallback") calls,
 * report how many keys already exist in en.ts vs are missing. No writes.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");
const transDir = path.join(root, "lib/i18n/translations");

// ── Load en.ts as a module (same trick as audit-i18n.js) ──
function loadEn() {
  const fp = path.join(transDir, "en.ts");
  let s = fs.readFileSync(fp, "utf8");
  s = s
    .replace(/^import\s+.*$/gm, "")
    .replace(/^export\s+default\s+\w+\s*;?\s*$/gm, "")
    .replace(/^export\s+type\s+TranslationKeys\s*=.*$/gm, "")
    // LocaleDictionary is a multiline mapped type. It is type-only syntax and
    // must be removed before the isolated CommonJS dictionary is evaluated.
    .replace(/export\s+type\s+LocaleDictionary\s*=\s*\{[\s\S]*?\n\};\s*$/m, "");
  s = s
    .replace(/const\s+\w+\s*:\s*\w+\s*=\s*\{/, "module.exports = {")
    .replace(/const\s+\w+\s*=\s*\{/, "module.exports = {");
  const sandboxModule = { exports: {} };
  vm.runInNewContext(s, { module: sandboxModule, exports: sandboxModule.exports }, { filename: fp });
  return sandboxModule.exports;
}
function flat(o, p = "") {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    const key = p ? p + "." + k : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) Object.assign(r, flat(v, key));
    else r[key] = String(v);
  }
  return r;
}

// ── Walk source files ──
const SKIP = new Set(["node_modules", ".next", ".git", "lib/i18n"]);
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const rel = path.relative(root, fp).replace(/\\/g, "/");
    if (SKIP.has(rel) || SKIP.has(name)) continue;
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(fp);
  }
  return out;
}

const RE = /\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1(?:\s*,\s*(['"])((?:\\.|(?!\3).)*?)\3)?\s*\)/g;

const en = flat(loadEn());
const enKeys = new Set(Object.keys(en));
const files = walk(root);

let total = 0;
const missing = new Map(); // key -> fallback
const missingByFile = new Map();
const filesTouched = new Set();

for (const fp of files) {
  const src = fs.readFileSync(fp, "utf8");
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src)) !== null) {
    total++;
    const key = m[2];
    const fb = m[4] || "";
    filesTouched.add(fp);
    if (!enKeys.has(key)) {
      if (!missing.has(key)) missing.set(key, fb);
      const rel = path.relative(root, fp).replace(/\\/g, "/");
      if (!missingByFile.has(rel)) missingByFile.set(rel, 0);
      missingByFile.set(rel, missingByFile.get(rel) + 1);
    }
  }
}

console.log(`Static t() calls: ${total}`);
console.log(`Files with static calls: ${filesTouched.size}`);
console.log(`Distinct keys MISSING from en.ts: ${missing.size}`);
console.log(`\n── Missing keys (key => fallback) ──`);
const sorted = [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, v] of sorted) console.log(`${k}\t${v}`);
if (missing.size) process.exitCode = 1;
