const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const attributes = new Set(["aria-label", "placeholder", "title", "alt"]);
const allowed = new Set([
  "beAlpha Logo", "beAlpha", "&copy;", "SHA-256", "Spotify", "Amazon Music",
  "Tidal", "Apple Music", "user@example.com", "ID:", "Spotify:", "Apple:",
  ".xlsx, .csv, .xml", "verified", "check_circle", "info", "audio_file", "-bit",
  "&bull;", "kHz", "mail", "System", "DDEX ERN 4.3.2", "VEVO",
]);

function walk(directory, output = []) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file, output);
    else if (file.endsWith(".tsx")) output.push(file);
  }
  return output;
}

function userFacingText(value) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2}/.test(text) || allowed.has(text)) return null;
  if (/^https?:|^[A-Z0-9_]+$/.test(text)) return null;
  return text;
}

const findings = [];
for (const file of [path.join(root, "app"), path.join(root, "components")].flatMap((directory) => walk(directory))) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    let text = null;
    let kind = "JSX text";
    if (ts.isJsxText(node)) text = userFacingText(node.text);
    else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const parentTag = ts.isJsxElement(node.parent) ? node.parent.openingElement.tagName.getText(ast) : "";
      if (parentTag !== "style") {
        const renderedStrings = (expression) => {
          if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text];
          if (ts.isConditionalExpression(expression)) {
            return [...renderedStrings(expression.whenTrue), ...renderedStrings(expression.whenFalse)];
          }
          return [];
        };
        const rendered = renderedStrings(node.expression)
          .map(userFacingText)
          .filter(Boolean);
        if (rendered.length) {
          const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
          rendered.forEach((value) => findings.push(
            `${path.relative(root, file)}:${position.line + 1} JSX expression: ${value}`,
          ));
        }
      }
    }
    else if (
      ts.isJsxAttribute(node) &&
      attributes.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      text = userFacingText(node.initializer.text);
      kind = node.name.text;
    }
    if (text) {
      const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      findings.push(`${path.relative(root, file)}:${position.line + 1} ${kind}: ${text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

if (findings.length) {
  console.error(`Hard-coded user-facing JSX strings: ${findings.length}`);
  findings.forEach((finding) => console.error(`  ${finding}`));
  process.exitCode = 1;
} else {
  console.log("Hard-coded user-facing JSX strings: 0");
}
