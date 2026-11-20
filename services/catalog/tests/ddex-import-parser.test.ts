import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseDdexXml } from "../src/ddex-import-parser.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function fixture(xml: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bealpha-ddex-"));
  roots.push(root);
  const file = path.join(root, "ern.xml");
  await writeFile(file, xml);
  return file;
}

describe("DDEX import parser", () => {
  it("streams an ERN main release and normalizes identifiers", async () => {
    const file = await fixture(`<?xml version="1.0"?><NewReleaseMessage><ResourceList><SoundRecording><SoundRecordingId><ISRC>US-ABC-26-00001</ISRC></SoundRecordingId><ResourceReference>A1</ResourceReference><ReferenceTitle><TitleText>Track One</TitleText></ReferenceTitle><Duration>PT3M12S</Duration></SoundRecording></ResourceList><ReleaseList><Release IsMainRelease="true"><ReleaseId><ICPN>123456789012</ICPN></ReleaseId><ReferenceTitle><TitleText>Album One</TitleText></ReferenceTitle><ReleaseType>Album</ReleaseType><ReleaseDetailsByTerritory><DisplayArtistName>Artist</DisplayArtistName><Genre><GenreText>Pop</GenreText></Genre><ReleaseDate>2026-07-13</ReleaseDate></ReleaseDetailsByTerritory><ResourceGroup><ResourceGroupContentItem><SequenceNumber>1</SequenceNumber><ReleaseResourceReference>A1</ReleaseResourceReference></ResourceGroupContentItem></ResourceGroup></Release></ReleaseList></NewReleaseMessage>`);
    await expect(parseDdexXml(file, 10000)).resolves.toEqual([{ title: "Album One", ean: "123456789012", type: "AUDIO", format: "ALBUM", genre: "Pop", releaseDate: new Date("2026-07-13T00:00:00.000Z"), displayArtist: "Artist", tracks: [{ title: "Track One", isrc: "USABC2600001", trackNumber: 1, discNumber: 1, duration: 192 }] }]);
  });

  it("rejects XML doctypes", async () => {
    const file = await fixture(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><x>&leak;</x>`);
    await expect(parseDdexXml(file, 10000)).rejects.toThrow("DDEX_XML_DOCTYPE_FORBIDDEN");
  });
});
