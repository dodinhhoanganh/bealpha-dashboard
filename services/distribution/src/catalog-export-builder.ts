import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { runZip } from "./package-builder.js";

export const DDEX_HEADERS: string[] = [
  // ── SECTION 1: RECORDING (Sound Recording / Resource) ──
  "Recording title",
  "Recording title language",
  "Recording title localized",
  "Recording subtitle",
  "Recording subtitle language",
  "Recording subtitle localized",
  "Recording alternative title",
  "Recording alternative title language",
  "Recording alternative title localized",
  "Recording display title",
  "Recording ISRC",
  "Recording catalogue number",
  "Recording proprietary ID",
  "Recording resource type",
  "Recording genre",
  "Recording sub-genre",
  "Recording explicit lyrics",
  "Recording parental warning",
  "Recording duration",
  "Recording creation date",
  "Recording mastering date",
  "Recording country of creation",
  "Recording country of mastering",
  "Recording language of performance",
  "Recording recording location",
  "Recording recording studio",
  "Recording BPM",
  "Recording musical key",
  "Recording time signature",
  "Recording audio codec",
  "Recording bit rate",
  "Recording bit depth",
  "Recording sample rate",
  "Recording number of channels",
  "Recording keywords",
  // Main Artist
  "Recording main artist",
  "Recording main artist localized",
  "Recording main artist key name",
  "Recording main artist ISNI",
  "Recording main artist DPID",
  "Recording main artist role",
  "Recording main artist sequence",
  "Recording main artist share",
  // Featured Artists #1-2
  "Recording featured artist #1",
  "Recording featured artist #1 localized",
  "Recording featured artist #1 key name",
  "Recording featured artist #1 ISNI",
  "Recording featured artist #1 role",
  "Recording featured artist #1 share",
  "Recording featured artist #2",
  "Recording featured artist #2 localized",
  "Recording featured artist #2 key name",
  "Recording featured artist #2 ISNI",
  "Recording featured artist #2 role",
  "Recording featured artist #2 share",
  // Contributors #1-4
  "Recording contributor #1",
  "Recording contributor #1 localized",
  "Recording contributor #1 role",
  "Recording contributor #1 ISNI",
  "Recording contributor #1 instrument",
  "Recording contributor #1 share",
  "Recording contributor #2",
  "Recording contributor #2 localized",
  "Recording contributor #2 role",
  "Recording contributor #2 ISNI",
  "Recording contributor #2 instrument",
  "Recording contributor #2 share",
  "Recording contributor #3",
  "Recording contributor #3 localized",
  "Recording contributor #3 role",
  "Recording contributor #3 ISNI",
  "Recording contributor #3 instrument",
  "Recording contributor #3 share",
  "Recording contributor #4",
  "Recording contributor #4 localized",
  "Recording contributor #4 role",
  "Recording contributor #4 ISNI",
  "Recording contributor #4 instrument",
  "Recording contributor #4 share",
  // Indirect Contributors
  "Recording indirect contributor #1",
  "Recording indirect contributor #1 role",
  "Recording indirect contributor #1 ISNI",
  "Recording indirect contributor #2",
  "Recording indirect contributor #2 role",
  "Recording indirect contributor #2 ISNI",
  // Producer
  "Recording producer",
  "Recording producer localized",
  "Recording producer ISNI",
  "Recording producer share",
  // Remixer
  "Recording remixer",
  "Recording remixer localized",
  "Recording remixer ISNI",
  // Conductor
  "Recording conductor",
  "Recording conductor localized",
  "Recording conductor ISNI",
  "Recording conductor share",
  // Label
  "Recording label",
  "Recording label localized",
  "Recording label P-line",
  "Recording label P-line year",
  "Recording label DPID",
  "Recording label share",
  // Rights controller
  "Recording rights controller name",
  "Recording rights controller role",
  "Recording rights controller share",
  // Territories
  "Recording territories",
  "Recording excluding territories",
  "Recording contract period begins",
  "Recording contract period ends",
  "Recording contract number",
  // Audio file & preview
  "Recording audio file name",
  "Recording audio file path",
  "Recording audio hash sum",
  "Recording audio hash sum algorithm",
  "Recording snippet start",
  "Recording snippet end",
  "Recording preview clip file name",

  // ── SECTION 2: RELEASE ──
  "Release title",
  "Release title language",
  "Release title localized",
  "Release subtitle",
  "Release subtitle language",
  "Release subtitle localized",
  "Release display title",
  "Release artist",
  "Release artist localized",
  "Release artist key name",
  "Release artist ISNI",
  "Release artist DPID",
  "Release type",
  "Release format",
  "Release genre",
  "Release sub-genre",
  "Release EAN / UPC",
  "Release GRID",
  "Release ICPN",
  "Release catalogue number",
  "Release proprietary ID",
  "Release outlets",
  "Release date",
  "Release original release date",
  "Release pre-order date",
  "Release duration",
  "Release number of tracks",
  "Release track number",
  "Release disc number",
  "Release volume number",
  "Release parental warning",
  "Release meta language",
  "Release territories",
  "Release excluding territories",
  "Release p-line text",
  "Release p-line year",
  "Release c-line text",
  "Release c-line year",
  "Release cover image file name",
  "Release cover image type",
  "Release status",
  // Deal
  "Deal commercial model type",
  "Deal use type",
  "Deal territory",
  "Deal start date",
  "Deal end date",
  "Deal price type",
  "Deal wholesale price",
  "Deal currency",
  "Deal takedown",

  // ── SECTION 3: COMPOSITION (Musical Work) ──
  "Composition title",
  "Composition title language",
  "Composition title localized",
  "Composition subtitle",
  "Composition subtitle language",
  "Composition subtitle localized",
  "Composition alternative title",
  "Composition alternative title language",
  "Composition alternative title localized",
  "Composition ISWC",
  "Composition catalogue number",
  "Composition proprietary ID",
  "Composition genre",
  "Composition sub-genre",
  "Composition creation date",
  "Composition lyrics languages",
  "Composition lyrics text",
  "Composition lyrics file name",
  "Composition territories",
  "Composition excluding territories",
  "Composition contract period begins",
  "Composition contract period ends",
  "Composition contract number",

  // ── SECTION 4: AUTHORS (Songwriters/Composers) #1-6 ──
  ...Array.from({ length: 6 }, (_, i) => {
    const n = i + 1;
    return [
      `Author #${n} name`,
      `Author #${n} name localized`,
      `Author #${n} first name`,
      `Author #${n} last name`,
      `Author #${n} role`,
      `Author #${n} IPI name number`,
      `Author #${n} IPI base number`,
      `Author #${n} ISNI`,
      `Author #${n} society`,
      `Author #${n} society territory`,
      `Author #${n} share`,
      `Author #${n} publisher`,
      `Author #${n} publisher localized`,
      `Author #${n} publisher IPI name number`,
      `Author #${n} publisher IPI base number`,
      `Author #${n} publisher ISNI`,
      `Author #${n} publisher society`,
      `Author #${n} publisher share`,
      `Author #${n} sub-publisher`,
      `Author #${n} sub-publisher share`,
    ];
  }).flat(),
];

export interface CatalogExportRelease extends Record<string, unknown> {
  id: string;
  title: string;
  tracks?: CatalogExportTrack[];
}

export interface CatalogExportTrack extends Record<string, unknown> {
  id: string;
  title: string;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function value(source: Record<string, unknown>, key: string): string {
  const item = source[key];
  if (item === null || item === undefined) return "";
  if (typeof item === "object") return JSON.stringify(item);
  return String(item);
}

function date(source: Record<string, unknown>, key: string): string {
  return value(source, key).split("T", 1)[0] ?? "";
}

function safeCell(item: string): string {
  return /^[=+\-@\t\r]/.test(item) ? `'${item}` : item;
}

function exportRow(release: CatalogExportRelease, track: CatalogExportTrack | undefined) {
  const row = Object.fromEntries(DDEX_HEADERS.map(header => [header, ""])) as Record<string, string>;
  const currentTrack = track ?? { id: "", title: "" };
  const artist = object(currentTrack.artist);
  const releaseArtist = object(release.artist);
  const label = object(release.label);
  const composition = object(currentTrack.composition);
  row["Recording title"] = value(currentTrack, "title");
  row["Recording title localized"] = value(currentTrack, "titleLocalized");
  row["Recording subtitle"] = value(currentTrack, "subtitle");
  row["Recording alternative title"] = value(currentTrack, "alternativeTitle");
  row["Recording ISRC"] = value(currentTrack, "isrc");
  row["Recording proprietary ID"] = value(currentTrack, "id");
  row["Recording resource type"] = release.type === "VIDEO" ? "Video" : "SoundRecording";
  row["Recording genre"] = value(currentTrack, "genre") || value(release, "genre");
  row["Recording explicit lyrics"] = currentTrack.explicitLyrics ? "Explicit" : "NotExplicit";
  row["Recording duration"] = value(currentTrack, "duration");
  row["Recording creation date"] = date(currentTrack, "creationDate");
  row["Recording language of performance"] = value(currentTrack, "lyricsLanguage");
  row["Recording main artist"] = value(artist, "name") || value(currentTrack, "displayArtist") || value(release, "displayArtist");
  row["Recording main artist ISNI"] = value(artist, "isni");
  row["Recording main artist DPID"] = value(artist, "dpid");
  row["Recording main artist role"] = "MainArtist";
  row["Recording main artist sequence"] = "1";
  row["Recording label"] = value(currentTrack, "recordingLabel") || value(label, "name");
  row["Recording label DPID"] = value(label, "dpid");
  row["Recording label share"] = value(currentTrack, "recordingLabelShare");
  row["Recording territories"] = value(currentTrack, "territories") || "Worldwide";
  row["Recording excluding territories"] = value(currentTrack, "excludingTerritories");
  row["Recording contract period begins"] = date(currentTrack, "contractPeriodBegins");
  row["Recording contract period ends"] = date(currentTrack, "contractPeriodEnds");
  row["Recording contract number"] = value(currentTrack, "contractNumber");
  row["Recording audio file name"] = value(currentTrack, "audioFileName");
  row["Recording snippet start"] = value(currentTrack, "snippetStart");
  row["Recording snippet end"] = value(currentTrack, "snippetEnd");
  row["Release title"] = value(release, "title");
  row["Release title localized"] = value(release, "titleLocalized");
  row["Release subtitle"] = value(release, "subtitle");
  row["Release artist"] = value(releaseArtist, "name") || value(release, "displayArtist");
  row["Release artist ISNI"] = value(releaseArtist, "isni");
  row["Release artist DPID"] = value(releaseArtist, "dpid");
  row["Release type"] = value(release, "type") || "AUDIO";
  row["Release format"] = value(release, "format") || "SINGLE";
  row["Release genre"] = value(release, "genre");
  row["Release sub-genre"] = value(release, "subGenre");
  row["Release EAN / UPC"] = value(release, "ean");
  row["Release ICPN"] = value(release, "ean");
  row["Release proprietary ID"] = value(release, "id");
  row["Release date"] = date(release, "releaseDate");
  row["Release original release date"] = date(release, "originalReleaseDate");
  row["Release number of tracks"] = String(release.tracks?.length ?? 0);
  row["Release track number"] = value(currentTrack, "trackNumber");
  row["Release disc number"] = value(currentTrack, "discNumber") || "1";
  row["Release meta language"] = value(release, "metaLanguage") || "en";
  row["Release territories"] = value(release, "territories") || "Worldwide";
  row["Release excluding territories"] = value(release, "excludingTerritories");
  row["Release p-line text"] = value(release, "pLine");
  row["Release p-line year"] = value(release, "pLineYear");
  row["Release c-line text"] = value(release, "cLine");
  row["Release c-line year"] = value(release, "cLineYear");
  row["Release cover image file name"] = value(release, "coverImageFileName") || value(release, "coverUrl").split("/").pop() || "";
  row["Release cover image type"] = "FrontCoverImage";
  row["Release status"] = value(release, "status");
  row["Composition title"] = value(composition, "title") || value(currentTrack, "title");
  row["Composition ISWC"] = value(composition, "iswc");
  row["Composition proprietary ID"] = value(composition, "id");
  row["Composition genre"] = value(composition, "genre") || value(currentTrack, "genre");
  row["Composition creation date"] = date(composition, "creationDate") || date(currentTrack, "creationDate");
  row["Composition lyrics languages"] = value(composition, "lyricsLanguages") || value(currentTrack, "lyricsLanguage");
  row["Composition lyrics text"] = value(currentTrack, "lyrics");
  row["Composition territories"] = value(composition, "territories") || value(currentTrack, "territories") || "Worldwide";
  const authors = array(composition.authors);
  for (let index = 0; index < Math.min(authors.length, 6); index += 1) {
    const author = authors[index];
    const prefix = `Author #${index + 1}`;
    row[`${prefix} name`] = value(author, "name");
    row[`${prefix} role`] = value(author, "role");
    row[`${prefix} IPI name number`] = value(author, "ipiNameNumber") || value(author, "ipi");
    row[`${prefix} ISNI`] = value(author, "isni");
    row[`${prefix} society`] = value(author, "society");
    row[`${prefix} share`] = value(author, "share") || value(author, "shareBasisPoints");
    row[`${prefix} publisher`] = value(author, "publisher");
  }
  return DDEX_HEADERS.map(header => safeCell(row[header] ?? ""));
}

export async function writeCatalogWorkbook(outputPath: string, releases: CatalogExportRelease[], zipper: typeof runZip = runZip) {
  const parts = `${outputPath}.parts`;
  await rm(parts, { recursive: true, force: true });
  await mkdir(path.join(parts, "_rels"), { recursive: true });
  await mkdir(path.join(parts, "xl", "_rels"), { recursive: true });
  await mkdir(path.join(parts, "xl", "worksheets"), { recursive: true });
  await writeFile(path.join(parts, "[Content_Types].xml"), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  await writeFile(path.join(parts, "_rels", ".rels"), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  await writeFile(path.join(parts, "xl", "workbook.xml"), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="DDEX Releases" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/></sheets></workbook>');
  await writeFile(path.join(parts, "xl", "_rels", "workbook.xml.rels"), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
  const sheet = createWriteStream(path.join(parts, "xl", "worksheets", "sheet1.xml"), { flags: "wx" });
  await writeChunk(sheet, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
  let rowNumber = 1;
  await writeChunk(sheet, worksheetRow(rowNumber, DDEX_HEADERS));
  for (const release of releases) {
    const tracks = release.tracks?.length ? release.tracks : [undefined];
    for (const track of tracks) {
      rowNumber += 1;
      await writeChunk(sheet, worksheetRow(rowNumber, exportRow(release, track)));
    }
  }
  await writeChunk(sheet, "</sheetData></worksheet>");
  sheet.end();
  await once(sheet, "finish");
  const instructions = ["DDEX ERN flat-file export", "Each row represents one recording within a release.", `Generated: ${new Date().toISOString()}`];
  await writeFile(path.join(parts, "xl", "worksheets", "sheet2.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${instructions.map((line, index) => worksheetRow(index + 1, [line])).join("")}</sheetData></worksheet>`);
  const entries = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"];
  await zipper(parts, outputPath, entries);
  await rm(parts, { recursive: true, force: true });
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function worksheetRow(rowNumber: number, cells: string[]) {
  return `<row r="${rowNumber}">${cells.map((cell, index) => `<c r="${columnName(index)}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join("")}</row>`;
}

async function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: string) {
  if (!stream.write(chunk, "utf8")) await once(stream, "drain");
}

