import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { SaxesParser } from "saxes";
import unzipper from "unzipper";

const MAX_ROWS = 10000;
const MAX_COLUMNS = 512;
const MAX_CELL_LENGTH = 10000;
const MAX_SPREADSHEET_BYTES = 50 * 1024 * 1024;

function records(rows: string[][]): Array<Record<string, string>> {
  const headers = (rows[0] ?? []).map(value => value.trim()).slice(0, MAX_COLUMNS);
  return rows.slice(1).filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]).filter(([header]) => Boolean(header))));
}

export async function parseCsv(filePath: string): Promise<Array<Record<string, string>>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let pendingQuote = false;
  const pushCell = () => { if (row.length >= MAX_COLUMNS) throw new Error("IMPORT_TOO_MANY_COLUMNS"); row.push(cell.slice(0, MAX_CELL_LENGTH)); cell = ""; };
  const pushRow = () => { pushCell(); if (rows.length >= MAX_ROWS + 1) throw new Error("IMPORT_TOO_MANY_ROWS"); rows.push(row); row = []; };
  for await (const chunk of createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
    for (const char of chunk) {
      if (pendingQuote) {
        if (char === '"') { cell += '"'; pendingQuote = false; continue; }
        quoted = false;
        pendingQuote = false;
      }
      if (quoted) {
        if (char === '"') pendingQuote = true;
        else if (cell.length < MAX_CELL_LENGTH) cell += char;
        continue;
      }
      if (char === '"' && cell.length === 0) quoted = true;
      else if (char === ";" || char === ",") pushCell();
      else if (char === "\n") pushRow();
      else if (char !== "\r" && cell.length < MAX_CELL_LENGTH) cell += char;
    }
  }
  if (quoted && !pendingQuote) throw new Error("IMPORT_CSV_QUOTE_INVALID");
  if (cell.length > 0 || row.length > 0) pushRow();
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return records(rows);
}

async function extractXlsxParts(filePath: string, directory: string): Promise<{ shared?: string; sheet: string }> {
  const parser = createReadStream(filePath).pipe(unzipper.Parse({ forceStream: true }));
  let shared: string | undefined;
  let sheet: string | undefined;
  let total = 0;
  for await (const entry of parser) {
    const name = entry.path.replace(/\\/g, "/").toLowerCase();
    const target = name === "xl/sharedstrings.xml" ? path.join(directory, "shared-strings.xml") : name === "xl/worksheets/sheet1.xml" ? path.join(directory, "sheet1.xml") : undefined;
    if (!target) { entry.autodrain(); continue; }
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { total += chunk.length; if (total > MAX_SPREADSHEET_BYTES) return callback(new Error("IMPORT_SPREADSHEET_TOO_LARGE")); callback(null, chunk); } });
    await pipeline(entry, meter, createWriteStream(target, { flags: "wx" }));
    if (name === "xl/sharedstrings.xml") shared = target; else sheet = target;
  }
  if (!sheet || !(await stat(sheet).catch(() => null))?.isFile()) throw new Error("IMPORT_XLSX_SHEET_MISSING");
  return { ...(shared ? { shared } : {}), sheet };
}

async function parseSharedStrings(filePath: string | undefined): Promise<string[]> {
  if (!filePath) return [];
  const values: string[] = [];
  let inside = false;
  let value = "";
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new Error("IMPORT_XML_DOCTYPE_FORBIDDEN"); });
  parser.on("opentag", tag => { if (tag.name.toLowerCase().endsWith("si")) { inside = true; value = ""; } });
  parser.on("text", text => { if (inside && value.length < MAX_CELL_LENGTH) value += text.slice(0, MAX_CELL_LENGTH - value.length); });
  parser.on("cdata", text => { if (inside && value.length < MAX_CELL_LENGTH) value += text.slice(0, MAX_CELL_LENGTH - value.length); });
  parser.on("closetag", tag => { if (tag.name.toLowerCase().endsWith("si")) { values.push(value); inside = false; if (values.length > (MAX_ROWS + 1) * MAX_COLUMNS) throw new Error("IMPORT_XLSX_STRINGS_TOO_MANY"); } });
  parser.on("error", error => { throw error; });
  for await (const chunk of createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 })) parser.write(chunk);
  parser.close();
  return values;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase() ?? "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

async function parseSheet(filePath: string, shared: string[]): Promise<string[][]> {
  const rows: string[][] = [];
  let currentRow: string[] | undefined;
  let currentColumn = -1;
  let currentType = "";
  let value = "";
  let collecting = false;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new Error("IMPORT_XML_DOCTYPE_FORBIDDEN"); });
  parser.on("opentag", tag => {
    const name = tag.name.toLowerCase();
    if (name.endsWith("row")) currentRow = [];
    if (name.endsWith("c")) { currentColumn = columnIndex(String(tag.attributes.r ?? "")); currentType = String(tag.attributes.t ?? ""); value = ""; }
    if (name.endsWith("v") || (currentType === "inlineStr" && name.endsWith("t"))) collecting = true;
  });
  parser.on("text", text => { if (collecting && value.length < MAX_CELL_LENGTH) value += text.slice(0, MAX_CELL_LENGTH - value.length); });
  parser.on("cdata", text => { if (collecting && value.length < MAX_CELL_LENGTH) value += text.slice(0, MAX_CELL_LENGTH - value.length); });
  parser.on("closetag", tag => {
    const name = tag.name.toLowerCase();
    if (name.endsWith("v") || name.endsWith("t")) collecting = false;
    if (name.endsWith("c") && currentRow && currentColumn >= 0 && currentColumn < MAX_COLUMNS) currentRow[currentColumn] = currentType === "s" ? shared[Number(value)] ?? "" : value;
    if (name.endsWith("row") && currentRow) { if (rows.length >= MAX_ROWS + 1) throw new Error("IMPORT_TOO_MANY_ROWS"); rows.push(currentRow); currentRow = undefined; }
  });
  parser.on("error", error => { throw error; });
  for await (const chunk of createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 })) parser.write(chunk);
  parser.close();
  return rows;
}

export async function parseXlsx(filePath: string, directory: string): Promise<Array<Record<string, string>>> {
  const parts = await extractXlsxParts(filePath, directory);
  return records(await parseSheet(parts.sheet, await parseSharedStrings(parts.shared)));
}
