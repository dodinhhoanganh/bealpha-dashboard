import { createReadStream } from "node:fs";

import { SaxesParser } from "saxes";

export interface DdexImportTrack {
  title: string;
  isrc?: string;
  trackNumber: number;
  discNumber: number;
  duration?: number;
  audioAssetId?: string;
}

export interface DdexImportRelease {
  title: string;
  ean?: string;
  type: "AUDIO" | "VIDEO";
  format: "SINGLE" | "EP" | "ALBUM" | "COMPILATION";
  genre?: string;
  releaseDate: Date;
  displayArtist?: string;
  coverUrl?: string;
  artistName?: string;
  labelName?: string;
  tracks: DdexImportTrack[];
}

interface Resource {
  reference?: string;
  title?: string;
  isrc?: string;
  duration?: number;
  type: "AUDIO" | "VIDEO";
}

interface ReleaseCandidate {
  isMain: boolean;
  title?: string;
  ean?: string;
  format?: string;
  genre?: string;
  releaseDate?: string;
  displayArtist?: string;
  refs: Array<{ reference: string; sequence?: number }>;
}

const MAX_TEXT_LENGTH = 4096;

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
}

function normalizeIsrc(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : undefined;
}

function normalizeEan(value: string): string | undefined {
  const normalized = value.replace(/\D/g, "");
  return /^\d{12,14}$/.test(normalized) ? normalized : undefined;
}

function durationSeconds(value: string): number | undefined {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value.trim());
  if (!match) return undefined;
  return Math.round(Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
}

function releaseFormat(value: string | undefined, trackCount: number): DdexImportRelease["format"] {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("compilation")) return "COMPILATION";
  if (normalized.includes("ep")) return "EP";
  if (normalized.includes("album")) return "ALBUM";
  return trackCount === 1 ? "SINGLE" : "ALBUM";
}

export async function parseDdexXml(filePath: string, maxResources: number): Promise<DdexImportRelease[]> {
  const resources = new Map<string, Resource>();
  const releases: ReleaseCandidate[] = [];
  const stack: string[] = [];
  let textValue = "";
  let currentResource: Resource | undefined;
  let currentRelease: ReleaseCandidate | undefined;
  let currentItem: { reference?: string; sequence?: number } | undefined;

  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new Error("DDEX_XML_DOCTYPE_FORBIDDEN"); });
  parser.on("opentag", tag => {
    const name = localName(tag.name);
    stack.push(name);
    textValue = "";
    if (name === "SoundRecording" || name === "Video") {
      currentResource = { type: name === "Video" ? "VIDEO" : "AUDIO" };
    } else if (name === "Release") {
      const attr = tag.attributes.IsMainRelease;
      currentRelease = { isMain: typeof attr === "string" && attr.toLowerCase() === "true", refs: [] };
    } else if (name === "ResourceGroupContentItem" && currentRelease) {
      currentItem = {};
    }
  });
  parser.on("text", value => {
    if (textValue.length < MAX_TEXT_LENGTH) textValue += value.slice(0, MAX_TEXT_LENGTH - textValue.length);
  });
  parser.on("cdata", value => {
    if (textValue.length < MAX_TEXT_LENGTH) textValue += value.slice(0, MAX_TEXT_LENGTH - textValue.length);
  });
  parser.on("closetag", tag => {
    const name = localName(tag.name);
    const value = textValue.trim();
    const parent = stack.at(-2);
    if (currentResource) {
      if (name === "ResourceReference" && value) currentResource.reference = value;
      if (name === "ISRC" && value) currentResource.isrc = normalizeIsrc(value);
      if (name === "TitleText" && parent === "ReferenceTitle" && value) currentResource.title = value;
      if (name === "Duration" && value) currentResource.duration = durationSeconds(value);
      if (name === "SoundRecording" || name === "Video") {
        if (!currentResource.reference || !currentResource.title) throw new Error("DDEX_RESOURCE_METADATA_MISSING");
        if (resources.size >= maxResources) throw new Error("DDEX_TOO_MANY_RESOURCES");
        resources.set(currentResource.reference, currentResource);
        currentResource = undefined;
      }
    }
    if (currentRelease) {
      if (name === "ICPN" && value) currentRelease.ean = normalizeEan(value);
      if (name === "TitleText" && parent === "ReferenceTitle" && value && !currentRelease.title) currentRelease.title = value;
      if (name === "ReleaseType" && value) currentRelease.format = value;
      if (name === "DisplayArtistName" && value && !currentRelease.displayArtist) currentRelease.displayArtist = value;
      if (name === "GenreText" && value && !currentRelease.genre) currentRelease.genre = value;
      if (name === "ReleaseDate" && value && !currentRelease.releaseDate) currentRelease.releaseDate = value;
      if (currentItem && name === "SequenceNumber" && value && currentItem.sequence === undefined) currentItem.sequence = Number(value);
      if (currentItem && name === "ReleaseResourceReference" && value) currentItem.reference = value;
      if (name === "ResourceGroupContentItem" && currentItem) {
        if (currentItem.reference) currentRelease.refs.push({ reference: currentItem.reference, ...(Number.isInteger(currentItem.sequence) ? { sequence: currentItem.sequence } : {}) });
        currentItem = undefined;
      }
      if (name === "Release") {
        releases.push(currentRelease);
        currentRelease = undefined;
      }
    }
    stack.pop();
    textValue = "";
  });
  parser.on("error", error => { throw error; });

  for await (const chunk of createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
    parser.write(chunk);
  }
  parser.close();

  const candidate = releases.find(item => item.isMain) ?? releases.find(item => item.ean) ?? releases.sort((a, b) => b.refs.length - a.refs.length)[0];
  if (!candidate?.title || !candidate.releaseDate) throw new Error("DDEX_MAIN_RELEASE_METADATA_MISSING");
  const releaseDate = new Date(`${candidate.releaseDate}T00:00:00.000Z`);
  if (Number.isNaN(releaseDate.getTime())) throw new Error("DDEX_RELEASE_DATE_INVALID");
  const selected = candidate.refs.length > 0 ? candidate.refs : [...resources.keys()].map((reference, index) => ({ reference, sequence: index + 1 }));
  const selectedResources = selected.map((item, index) => {
    const resource = resources.get(item.reference);
    if (!resource) throw new Error("DDEX_REFERENCED_RESOURCE_MISSING");
    return { resource, track: { title: resource.title!, ...(resource.isrc ? { isrc: resource.isrc } : {}), trackNumber: item.sequence ?? index + 1, discNumber: 1, ...(resource.duration !== undefined ? { duration: resource.duration } : {}) } };
  });
  const tracks = selectedResources.map(item => item.track);
  if (tracks.length === 0) throw new Error("DDEX_TRACKS_MISSING");
  return [{ title: candidate.title, ...(candidate.ean ? { ean: candidate.ean } : {}), type: selectedResources.some(item => item.resource.type === "VIDEO") ? "VIDEO" : "AUDIO", format: releaseFormat(candidate.format, tracks.length), ...(candidate.genre ? { genre: candidate.genre } : {}), releaseDate, ...(candidate.displayArtist ? { displayArtist: candidate.displayArtist } : {}), tracks }];
}
