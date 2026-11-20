import path from "node:path";

import type { DdexImportRelease } from "./ddex-import-parser.js";

interface ArchiveEntry {
  entryName: string;
  asset: { id: string; type: "AUDIO" | "VIDEO" | "IMAGE"; fileName: string; status: string };
}

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) if (row[key]?.trim()) return row[key].trim();
  return "";
}

function baseName(value: string): string {
  return path.basename(value.replace(/\\/g, "/")).toLowerCase();
}

function date(value: string): Date {
  const serial = Number(value);
  const parsed = Number.isFinite(serial) && serial > 10000 && serial < 2958466 ? new Date((serial - 25569) * 86400 * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function integer(value: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

function format(value: string, tracks: number): DdexImportRelease["format"] {
  const normalized = value.toUpperCase().trim();
  if (["EP", "MINI ALBUM"].includes(normalized)) return "EP";
  if (["COMPILATION", "MIXTAPE", "SOUNDTRACK", "BOX SET"].includes(normalized)) return "COMPILATION";
  if (["ALBUM", "LP", "DELUXE", "DELUXE EDITION", "DOUBLE ALBUM"].includes(normalized)) return "ALBUM";
  return tracks === 1 ? "SINGLE" : "ALBUM";
}

function ean(value: string): string | undefined {
  const normalized = value.replace(/\D/g, "");
  return /^\d{12,14}$/.test(normalized) ? normalized : undefined;
}

function isrc(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : undefined;
}

export function mapSpreadsheetRows(rows: Array<Record<string, string>>, archiveEntries: ArchiveEntry[]): DdexImportRelease[] {
  if (rows.length === 0) throw new Error("IMPORT_NO_DATA");
  if (!Object.keys(rows[0]).includes("Release title")) throw new Error("IMPORT_RELEASE_TITLE_COLUMN_MISSING");
  const assets = new Map(archiveEntries.filter(entry => !["ERROR", "ARCHIVED"].includes(entry.asset.status)).map(entry => [entry.asset.fileName.toLowerCase(), entry.asset]));
  const groups = new Map<string, Array<Record<string, string>>>();
  for (const row of rows) {
    const title = col(row, "Release title");
    if (!title) continue;
    const group = groups.get(title) ?? [];
    group.push(row);
    groups.set(title, group);
  }
  if (groups.size === 0) throw new Error("IMPORT_NO_RELEASES");
  return [...groups.entries()].map(([title, releaseRows]) => {
    const first = releaseRows[0];
    const releaseArtist = col(first, "Release artist", "Recording main artist");
    const coverAsset = assets.get(baseName(col(first, "Release cover image file name")));
    const releaseEan = ean(col(first, "Release EAN / UPC", "Release EAN"));
    return {
      title,
      ...(releaseEan ? { ean: releaseEan } : {}),
      type: col(first, "Release type").toUpperCase() === "VIDEO" ? "VIDEO" : "AUDIO",
      format: format(col(first, "Release format"), releaseRows.length),
      ...(col(first, "Release genre") ? { genre: col(first, "Release genre") } : {}),
      releaseDate: date(col(first, "Release date")),
      ...(releaseArtist ? { displayArtist: releaseArtist, artistName: releaseArtist.split(";")[0].trim() } : {}),
      ...(col(first, "Recording label", "Release label") ? { labelName: col(first, "Recording label", "Release label") } : {}),
      ...(coverAsset?.type === "IMAGE" ? { coverUrl: `/media-public/${coverAsset.id}` } : {}),
      tracks: releaseRows.map((row, index) => {
        const recordingIsrc = isrc(col(row, "Recording ISRC"));
        const audioAsset = assets.get(baseName(col(row, "Recording audio file name")));
        return {
          title: col(row, "Recording title") || `Track ${index + 1}`,
          ...(recordingIsrc ? { isrc: recordingIsrc } : {}),
          trackNumber: integer(col(row, "Recording track number", "Track number"), index + 1, 999),
          discNumber: integer(col(row, "Recording disc number", "Disc number"), 1, 99),
          ...(integer(col(row, "Recording duration"), 0, 86400) > 0 ? { duration: integer(col(row, "Recording duration"), 0, 86400) } : {}),
          ...(audioAsset && ["AUDIO", "VIDEO"].includes(audioAsset.type) ? { audioAssetId: audioAsset.id } : {})
        };
      })
    };
  });
}
