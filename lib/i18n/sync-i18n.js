#!/usr/bin/env node
/**
 * sync-i18n.js — Propagates en.ts keys to all secondary language files.
 * Walks the en.ts structure and adds any missing keys (using the English value
 * as a placeholder) into every other translation file.
 */

const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "translations");
const EN_FILE = path.join(DIR, "en.ts");
const SKIP = new Set(["en.ts", "vi.ts"]); // vi.ts maintained manually

// ── Parse the default-export object from a .ts file ──
function parseTS(filePath) {
  let src = fs.readFileSync(filePath, "utf-8");
  // Strip import type, export default, export type
  src = src.replace(/^import\s+type\s+.*$/gm, "");
  src = src.replace(/^export\s+default\s+\w+;\s*$/gm, "");
  src = src.replace(/^export\s+type\s+.*$/gm, "");
  // Replace `const xx: Type = {` or `const xx = {` with `module.exports = {`
  src = src.replace(/^const\s+\w+(?:\s*:\s*\w+)?\s*=\s*\{/m, "module.exports = {");
  // Write a temp .cjs, require it, delete it
  const tmp = filePath + ".__sync_tmp.cjs";
  fs.writeFileSync(tmp, src);
  try {
    delete require.cache[require.resolve(tmp)];
    return require(tmp);
  } finally {
    fs.unlinkSync(tmp);
  }
}

// ── Deep-merge: add missing keys from `source` into `target` ──
function deepMerge(source, target) {
  let added = 0;
  for (const key of Object.keys(source)) {
    if (!(key in target)) {
      target[key] = source[key]; // use English as placeholder
      added++;
    } else if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      typeof target[key] === "object" &&
      target[key] !== null
    ) {
      added += deepMerge(source[key], target[key]);
    }
  }
  return added;
}

// ── Serialize object back to TS format ──
function serialize(obj, indent = 2) {
  const pad = " ".repeat(indent);
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;
    if (typeof value === "object" && value !== null) {
      lines.push(`${pad}${safeKey}: {`);
      lines.push(serialize(value, indent + 2));
      lines.push(`${pad}},`);
    } else {
      const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      lines.push(`${pad}${safeKey}: "${escaped}",`);
    }
  }
  return lines.join("\n");
}

// ── Main ──
const en = parseTS(EN_FILE);
const files = fs.readdirSync(DIR).filter(f => f.endsWith(".ts") && !SKIP.has(f));

let totalAdded = 0;
for (const file of files) {
  const fp = path.join(DIR, file);
  const lang = parseTS(fp);
  const added = deepMerge(en, lang);
  if (added > 0) {
    const varName = file.replace(".ts", "");
    const content = [
      `import type { TranslationKeys } from "./en";`,
      ``,
      `const ${varName}: TranslationKeys = {`,
      serialize(lang),
      `};`,
      ``,
      `export default ${varName};`,
      ``,
    ].join("\n");
    fs.writeFileSync(fp, content, "utf-8");
    console.log(`✅ ${file}: +${added} keys`);
    totalAdded += added;
  } else {
    console.log(`✓  ${file}: up to date`);
  }
}

console.log(`\nDone. ${totalAdded} total keys added across ${files.length} files.`);
