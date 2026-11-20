import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { mapSpreadsheetRows } from "../src/spreadsheet-catalog-mapper.js";
import { parseCsv, parseXlsx } from "../src/spreadsheet-import-parser.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bealpha-sheet-"));
  roots.push(directory);
  return directory;
}

describe("spreadsheet import parser", () => {
  it("parses bounded semicolon CSV", async () => {
    const directory = await root();
    const file = path.join(directory, "catalog.csv");
    await writeFile(file, "Release title;Recording title;Recording ISRC\nAlbum;Track;USABC2600001\n");
    await expect(parseCsv(file)).resolves.toEqual([{ "Release title": "Album", "Recording title": "Track", "Recording ISRC": "USABC2600001" }]);
  });

  it("streams the first XLSX worksheet", async () => {
    const directory = await root();
    const file = path.join(directory, "catalog.xlsx");
    const shared = `<?xml version="1.0"?><sst><si><t>Release title</t></si><si><t>Recording title</t></si><si><t>Album</t></si><si><t>Track</t></si></sst>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>`;
    await writeFile(file, storedZip([{ name: "xl/sharedStrings.xml", data: Buffer.from(shared) }, { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) }]));
    await expect(parseXlsx(file, directory)).resolves.toEqual([{ "Release title": "Album", "Recording title": "Track" }]);
  });

  it("maps archive WAV and cover assets into Catalog IDs", () => {
    const audioId = "11111111-1111-4111-8111-111111111111";
    const imageId = "22222222-2222-4222-8222-222222222222";
    const result = mapSpreadsheetRows([{ "Release title": "Album", "Release artist": "Artist", "Release date": "2026-07-13", "Release cover image file name": "cover.jpg", "Recording title": "Track", "Recording audio file name": "disc/track.wav" }], [{ entryName: "audio/track.wav", asset: { id: audioId, type: "AUDIO", fileName: "track.wav", status: "READY" } }, { entryName: "cover.jpg", asset: { id: imageId, type: "IMAGE", fileName: "cover.jpg", status: "READY" } }]);
    expect(result[0]).toMatchObject({ title: "Album", artistName: "Artist", coverUrl: `/media-public/${imageId}`, tracks: [{ title: "Track", audioAssetId: audioId }] });
  });
});
