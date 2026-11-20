import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { DdexParty, DspRecipient } from "./config.js";

const dpidSchema = z.string().trim().regex(/^PADPIDA[A-Za-z0-9]+$/);
const gtinSchema = z.string().regex(/^\d{12,14}$/).refine(value => {
  const digits = [...value].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return check === (10 - (sum % 10)) % 10;
}, "Invalid GTIN check digit");
const partySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  isni: z.string().trim().min(1).max(32).nullable().optional(),
  ipi: z.string().trim().min(1).max(32).nullable().optional()
}).passthrough();
const copyrightLineSchema = z.string().trim().min(1).max(1000);
const territoryCodeSchema = z.string().trim().transform(value => value.toUpperCase() === "WORLDWIDE" ? "Worldwide" : value.toUpperCase()).pipe(z.string().regex(/^(?:Worldwide|[A-Z]{2})$/));
const territoryListSchema = z.array(territoryCodeSchema).min(1).max(250).refine(values => new Set(values).size === values.length, "Territory codes must be unique");
const validityEndSchema = z.string().trim().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) || z.string().datetime({ offset: true }).safeParse(value).success, "Invalid validity end date");
const contributorPartySchema = z.object({
  name: z.string().trim().min(1).max(255),
  role: z.string().trim().min(1).max(100).optional(),
  isni: z.string().trim().min(1).max(32).nullable().optional(),
  ipi: z.string().trim().min(1).max(32).nullable().optional()
}).passthrough();
const contributorSchema = contributorPartySchema.required({ role: true });
const namedContributorSchema = z.union([z.string().trim().min(1).max(255), contributorPartySchema]);
const contributorGroupsSchema = z.object({
  performers: z.array(contributorSchema).max(100).optional(),
  studioPersonnel: z.array(contributorSchema).max(100).optional(),
  labelPersonnel: z.array(contributorSchema).max(100).optional(),
  compositional: z.array(contributorSchema).max(100).optional()
}).passthrough();
const contributorsSchema = z.union([z.array(contributorSchema).max(400), contributorGroupsSchema]);
const compositionSchema = z.object({
  iswc: z.string().trim().regex(/^T-?\d{3}\.?(?:\d{3})\.?(?:\d{3})-?\d$/).optional(),
  authors: z.array(contributorSchema).max(100).nullable().optional(),
  territories: z.string().trim().min(1).max(2048).optional(),
  excludingTerritories: z.string().trim().max(2048).nullable().optional(),
  contractPeriodEnds: z.union([z.string(), z.date()]).nullable().optional()
}).passthrough();
const trackMetadataSchema = z.object({
  producer: namedContributorSchema.optional(),
  remixer: namedContributorSchema.optional(),
  contributors: contributorsSchema.optional(),
  iswc: z.string().trim().optional()
}).passthrough();
const releaseMetadataSchema = z.object({
  targetDsps: z.array(z.string().regex(/^[a-z0-9_]{2,64}$/)).min(1).max(64).optional(),
  territories: territoryListSchema.optional(),
  excludingTerritories: territoryListSchema.optional(),
  validityEndDate: validityEndSchema.optional(),
  contractPeriod: z.object({ ends: validityEndSchema.optional() }).passthrough().optional()
}).passthrough();

export const catalogSnapshotSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  ean: gtinSchema,
  type: z.literal("AUDIO"),
  format: z.enum(["SINGLE", "EP", "ALBUM", "COMPILATION"]),
  status: z.enum(["LOCKED_FOR_DELIVERY", "DELIVERED", "RELEASED", "TAKEDOWN"]),
  tenantId: z.string().uuid(),
  displayArtist: z.string().trim().min(1).max(500),
  coverUrl: z.string().trim().min(1).max(2048).optional(),
  releaseDate: z.string().datetime({ offset: true }),
  originalReleaseDate: z.string().trim().min(1).optional(),
  metaLanguage: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/).default("en"),
  genre: z.string().trim().min(1).max(100),
  subGenre: z.string().trim().min(1).max(100).optional(),
  cLine: copyrightLineSchema,
  pLine: copyrightLineSchema,
  territories: territoryListSchema.optional(),
  excludingTerritories: territoryListSchema.optional(),
  validityEndDate: validityEndSchema.optional(),
  metadata: releaseMetadataSchema.optional(),
  artist: partySchema.nullable().optional(),
  label: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(255)
  }).passthrough(),
  tracks: z.array(z.object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    version: z.string().trim().max(255).optional(),
    isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/),
    trackNumber: z.number().int().positive(),
    discNumber: z.number().int().positive(),
    duration: z.number().int().positive(),
    displayArtist: z.string().trim().min(1).max(500).nullable().optional(),
    artist: partySchema.nullable().optional(),
    explicitContent: z.enum(["NONE", "EXPLICIT", "CLEAN"]).default("NONE"),
    pLine: copyrightLineSchema.optional(),
    producer: namedContributorSchema.optional(),
    remixer: namedContributorSchema.optional(),
    contributors: contributorsSchema.optional(),
    iswc: z.string().trim().optional(),
    composition: compositionSchema.nullable().optional(),
    metadata: trackMetadataSchema.optional(),
    audioAssetId: z.string().uuid()
  }).passthrough()).min(1).max(10000)
}).passthrough().superRefine((snapshot, context) => {
  if (snapshot.format === "SINGLE" && snapshot.tracks.length !== 1) {
    context.addIssue({ code: "custom", path: ["tracks"], message: "A SINGLE must contain exactly one track" });
  }
  const territories = snapshot.territories ?? snapshot.metadata?.territories;
  const excludedTerritories = snapshot.excludingTerritories ?? snapshot.metadata?.excludingTerritories;
  if (territories && excludedTerritories) context.addIssue({ code: "custom", path: ["excludingTerritories"], message: "TerritoryCode and ExcludedTerritoryCode are mutually exclusive" });
  const isrcs = new Set<string>();
  const assets = new Set<string>();
  const positions = new Set<string>();
  for (const [index, track] of snapshot.tracks.entries()) {
    const position = `${track.discNumber}:${track.trackNumber}`;
    if (isrcs.has(track.isrc)) context.addIssue({ code: "custom", path: ["tracks", index, "isrc"], message: "Track ISRCs must be unique" });
    if (assets.has(track.audioAssetId)) context.addIssue({ code: "custom", path: ["tracks", index, "audioAssetId"], message: "Every track requires a distinct audio master" });
    if (positions.has(position)) context.addIssue({ code: "custom", path: ["tracks", index, "trackNumber"], message: "Track positions must be unique within a disc" });
    isrcs.add(track.isrc);
    assets.add(track.audioAssetId);
    positions.add(position);
  }
});
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export interface DeliveryAssetMetadata {
  fileName: string;
  contentType: string;
  sizeBytes: bigint;
  sha256?: string;
}

export interface ErnGenerationInput {
  snapshot: CatalogSnapshot;
  sender: DdexParty;
  recipient: DspRecipient;
  messageType: "NewReleaseMessage" | "UpdateReleaseMessage" | "TakedownMessage";
  ernVersion: "4.3";
  avsVersionId: string;
  messageId: string;
  messageThreadId: string;
  createdAt: Date;
  assets?: Map<string, DeliveryAssetMetadata>;
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${rest}S`;
}

function lineYear(value: string) {
  return /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(value)?.[1];
}

function copyrightLine(tag: "PLine" | "CLine", value: string) {
  const year = lineYear(value);
  return `<${tag}>${year ? `<Year>${year}</Year>` : ""}<${tag}Text>${xml(value)}</${tag}Text></${tag}>`;
}

function displayTitle(title: string, version?: string) {
  const display = version ? `${title} (${version})` : title;
  return `<DisplayTitleText>${xml(display)}</DisplayTitleText><DisplayTitle ApplicableTerritoryCode="Worldwide"><TitleText>${xml(title)}</TitleText>${version ? `<SubTitle SubTitleType="Version">${xml(version)}</SubTitle>` : ""}</DisplayTitle>`;
}

function parentalWarning(value: CatalogSnapshot["tracks"][number]["explicitContent"]) {
  return value === "EXPLICIT" ? "Explicit" : "NotExplicit";
}

function extension(fileName: string) {
  const value = path.extname(fileName).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(value)) throw new Error("ERN_AUDIO_FILE_EXTENSION_INVALID");
  return value;
}

function audioFormat(asset: DeliveryAssetMetadata) {
  const ext = extension(asset.fileName);
  if ((asset.contentType === "audio/wav" || asset.contentType === "audio/x-wav" || asset.contentType === "audio/vnd.wave") && ext === ".wav") return { container: "WAV", codec: "PCM" };
  if ((asset.contentType === "audio/flac" || asset.contentType === "audio/x-flac") && ext === ".flac") return { container: "FLAC", codec: "FLAC" };
  throw new Error("ERN_AUDIO_FORMAT_UNSUPPORTED");
}

const coverReference = /^media-asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function coverAssetId(reference: string | undefined): string {
  const assetId = reference ? coverReference.exec(reference)?.[1] : undefined;
  if (!assetId) throw new Error("ERN_COVER_REFERENCE_INVALID");
  return assetId.toLowerCase();
}

function imageFormat(asset: DeliveryAssetMetadata) {
  const ext = extension(asset.fileName);
  if (asset.contentType === "image/jpeg" && (ext === ".jpg" || ext === ".jpeg")) return { codec: "JPEG", extension: ".jpg" };
  if (asset.contentType === "image/png" && ext === ".png") return { codec: "PNG", extension: ".png" };
  throw new Error("ERN_COVER_FORMAT_UNSUPPORTED");
}

export function coverResourceFileName(snapshot: Pick<CatalogSnapshot, "ean">, asset: DeliveryAssetMetadata) {
  return `${snapshot.ean}_FrontCoverImage_001${imageFormat(asset).extension}`;
}

export function resourceFileName(snapshot: CatalogSnapshot, index: number, asset: DeliveryAssetMetadata) {
  const hierarchy = String(index + 1).padStart(3, "0");
  return `${snapshot.ean}_T${index + 1}_SoundRecording_${hierarchy}${extension(asset.fileName)}`;
}

function fileSizeKilobytes(bytes: bigint) {
  const whole = bytes / 1000n;
  const fraction = (bytes % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function partyName(name: string) {
  return `<PartyName><FullName>${xml(name)}</FullName></PartyName>`;
}

type ContributorParty = { name: string; role?: string; isni?: string | null; ipi?: string | null };
type ContributorCredit = ContributorParty & { role: string };

function partyIdentifiers(party: ContributorParty) {
  if (!party.isni && !party.ipi) return "";
  const isni = party.isni?.replace(/[\s-]/g, "").toUpperCase();
  const ipi = party.ipi?.replace(/[\s-]/g, "");
  if (isni && !/^\d{15}[\dX]$/.test(isni)) throw new Error("ERN_PARTY_ISNI_INVALID");
  if (ipi && !/^\d{11}$/.test(ipi)) throw new Error("ERN_PARTY_IPI_INVALID");
  return `<PartyId>${isni ? `<ISNI>${isni}</ISNI>` : ""}${ipi ? `<IpiNameNumber>${ipi}</IpiNameNumber>` : ""}</PartyId>`;
}

function normalizedIswc(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^T\d{10}$/.test(normalized)) throw new Error("ERN_ISWC_INVALID");
  return normalized;
}

const standardContributorRoles = new Set([
  "Adapter", "Arranger", "Artist", "Author", "Composer", "ComposerLyricist", "Conductor", "DJ", "ExecutiveProducer",
  "LeadVocalist", "Lyricist", "MasteringEngineer", "MixingEngineer", "MusicDirector", "Musician", "MusicPublisher",
  "Performer", "RecordingEngineer", "Remixer", "SoundDesigner", "StudioProducer", "Translator", "VideoDirector",
  "Vocalist", "VocalProducer"
]);

function contributorRole(value: string, namespace: string) {
  const normalized = value.trim().replace(/[\s_-]+(.)/g, (_, letter: string) => letter.toUpperCase());
  const aliases: Record<string, string> = {
    backgroundVocals: "Vocalist", coProducer: "StudioProducer", leadVocals: "LeadVocalist", producer: "StudioProducer",
    publisher: "MusicPublisher", songwriter: "ComposerLyricist", studioProducer: "StudioProducer", remixer: "Remixer"
  };
  const role = aliases[normalized.charAt(0).toLowerCase() + normalized.slice(1)] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
  if (standardContributorRoles.has(role)) return `<Role><Value>${xml(role)}</Value></Role>`;
  return `<Role><Value Namespace="${xml(namespace)}" UserDefinedValue="${xml(value.trim())}">UserDefined</Value></Role>`;
}

function groupedContributors(value: CatalogSnapshot["tracks"][number]["contributors"]): ContributorCredit[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value).flatMap(items => Array.isArray(items) ? items : []);
}

function namedCredit(value: CatalogSnapshot["tracks"][number]["producer"], role: string): ContributorCredit[] {
  if (!value) return [];
  return [{ ...(typeof value === "string" ? { name: value } : value), role }];
}

function creditsForTrack(track: CatalogSnapshot["tracks"][number]) {
  const metadata = track.metadata;
  const credits = [
    ...namedCredit(track.producer ?? metadata?.producer, "StudioProducer"),
    ...namedCredit(track.remixer ?? metadata?.remixer, "Remixer"),
    ...groupedContributors(track.contributors ?? metadata?.contributors),
    ...(track.composition?.authors ?? [])
  ];
  const seen = new Set<string>();
  return credits.filter(credit => {
    const key = `${credit.name}\0${credit.role}\0${credit.isni ?? ""}\0${credit.ipi ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dealTerritories(snapshot: CatalogSnapshot) {
  const included = snapshot.territories ?? snapshot.metadata?.territories;
  const excluded = snapshot.excludingTerritories ?? snapshot.metadata?.excludingTerritories;
  if (included && excluded) throw new Error("ERN_DEAL_TERRITORIES_CONFLICT");
  const tag = excluded ? "ExcludedTerritoryCode" : "TerritoryCode";
  const values = excluded ?? included ?? ["Worldwide"];
  return values.map(value => `<${tag}>${value}</${tag}>`).join("");
}

function dealValidity(snapshot: CatalogSnapshot) {
  const suppliedEnd = snapshot.validityEndDate ?? snapshot.metadata?.validityEndDate ?? snapshot.metadata?.contractPeriod?.ends;
  const end = suppliedEnd && /^\d{4}-\d{2}-\d{2}$/.test(suppliedEnd) ? `${suppliedEnd}T23:59:59Z` : suppliedEnd;
  if (end && Date.parse(end) < Date.parse(snapshot.releaseDate)) throw new Error("ERN_DEAL_VALIDITY_END_BEFORE_START");
  return `<ValidityPeriod><StartDateTime>${xml(snapshot.releaseDate)}</StartDateTime>${end ? `<EndDateTime>${xml(end)}</EndDateTime>` : ""}</ValidityPeriod>`;
}

function releaseResourceGroup(snapshot: CatalogSnapshot, hasCover: boolean) {
  const discs = new Map<number, Array<{ reference: string; trackNumber: number }>>();
  snapshot.tracks.forEach((track, index) => {
    const items = discs.get(track.discNumber) ?? [];
    items.push({ reference: `A${index + 1}`, trackNumber: track.trackNumber });
    discs.set(track.discNumber, items);
  });
  const orderedDiscs = [...discs.entries()].sort(([left], [right]) => left - right);
  const content = (items: Array<{ reference: string; trackNumber: number }>) => items
    .sort((left, right) => left.trackNumber - right.trackNumber)
    .map(item => `<ResourceGroupContentItem><SequenceNumber>${item.trackNumber}</SequenceNumber><ReleaseResourceReference>${item.reference}</ReleaseResourceReference></ResourceGroupContentItem>`)
    .join("");
  const coverLink = hasCover ? '<LinkedReleaseResourceReference LinkDescription="CoverArt">AImage1</LinkedReleaseResourceReference>' : "";
  if (orderedDiscs.length === 1) return `<ResourceGroup><SequenceNumber>1</SequenceNumber>${content(orderedDiscs[0]![1])}${coverLink}</ResourceGroup>`;
  const groups = orderedDiscs.map(([discNumber, items]) => `<ResourceGroup ResourceGroupType="Component"><SequenceNumber>${discNumber}</SequenceNumber>${content(items)}</ResourceGroup>`).join("");
  return `<ResourceGroup><SequenceNumber>1</SequenceNumber>${groups}${coverLink}</ResourceGroup>`;
}

/**
 * Generates ERN 4.3.2 SimpleAudioSingle or Audio profile XML. ERN updates and
 * takedowns are statements of truth sent as NewReleaseMessage documents;
 * a takedown is represented by omitting DealList, as prescribed by DDEX.
 */
export function generateErn(input: ErnGenerationInput): string {
  const { snapshot, sender, recipient, messageType, ernVersion, avsVersionId, messageId, messageThreadId, createdAt } = input;
  if (ernVersion !== "4.3") throw new Error("ERN_VERSION_UNSUPPORTED");
  dpidSchema.parse(sender.partyId);
  dpidSchema.parse(recipient.partyId);
  if (!/^\d+$/.test(avsVersionId)) throw new Error("ERN_AVS_VERSION_INVALID");
  const takedown = messageType === "TakedownMessage";
  const releaseArtistName = snapshot.artist?.name ?? snapshot.displayArtist;
  const releaseDate = snapshot.releaseDate.slice(0, 10);
  const messageFileName = `${snapshot.ean}.xml`;
  const parties = new Map<string, { reference: string; party: ContributorParty }>();
  const registerParty = (party: ContributorParty) => {
    const key = `${party.name}\0${party.isni ?? ""}\0${party.ipi ?? ""}`;
    const existing = parties.get(key);
    if (existing) return existing.reference;
    const reference = `P${parties.size + 1}`;
    parties.set(key, { reference, party });
    return reference;
  };
  const releaseArtistReference = registerParty(snapshot.artist ?? { name: releaseArtistName });
  const artistReferences = new Map<string, string>([[releaseArtistName, releaseArtistReference]]);
  for (const track of snapshot.tracks) {
    const artistName = track.displayArtist ?? track.artist?.name ?? releaseArtistName;
    if (!artistReferences.has(artistName)) artistReferences.set(artistName, registerParty(track.artist ?? { name: artistName }));
    for (const credit of creditsForTrack(track)) registerParty(credit);
  }
  const artistParties = [...parties.values()].map(({ reference, party }) => `<Party><PartyReference>${reference}</PartyReference>${partyName(party.name)}${partyIdentifiers(party)}</Party>`).join("");
  const labelParty = `<Party><PartyReference>PLabel</PartyReference>${partyName(snapshot.label.name)}</Party>`;
  const soundRecordings = snapshot.tracks.map((track, index) => {
    const artistName = track.displayArtist ?? track.artist?.name ?? releaseArtistName;
    const artistReference = artistReferences.get(artistName)!;
    const workId = normalizedIswc(track.iswc ?? track.metadata?.iswc ?? track.composition?.iswc);
    const contributors = creditsForTrack(track).map((credit, creditIndex) => {
      const reference = registerParty(credit);
      return `<Contributor SequenceNumber="${creditIndex + 1}"><ContributorPartyReference>${reference}</ContributorPartyReference>${contributorRole(credit.role, sender.partyId)}</Contributor>`;
    }).join("");
    const asset = input.assets?.get(track.audioAssetId);
    if (!takedown && !asset) throw new Error("ERN_AUDIO_ASSET_METADATA_MISSING");
    const technical = asset && !takedown ? (() => {
      const format = audioFormat(asset);
      const fileName = resourceFileName(snapshot, index, asset);
      return `<TechnicalDetails><TechnicalResourceDetailsReference>T${index + 1}</TechnicalResourceDetailsReference><DeliveryFile><Type>AudioFile</Type><ContainerFormat>${format.container}</ContainerFormat><AudioCodecType>${format.codec}</AudioCodecType><File><URI>resources/${xml(fileName)}</URI><FileSize>${fileSizeKilobytes(asset.sizeBytes)}</FileSize></File></DeliveryFile></TechnicalDetails>`;
    })() : "";
    return `<SoundRecording><ResourceReference>A${index + 1}</ResourceReference><Type>MusicalWorkSoundRecording</Type><SoundRecordingEdition><ResourceId><ISRC>${xml(track.isrc)}</ISRC></ResourceId>${copyrightLine("PLine", track.pLine ?? snapshot.pLine)}${technical}</SoundRecordingEdition>${workId ? `<WorkId><ISWC>${workId}</ISWC></WorkId>` : ""}${displayTitle(track.title, track.version)}<DisplayArtistName ApplicableTerritoryCode="Worldwide">${xml(artistName)}</DisplayArtistName><DisplayArtist SequenceNumber="1"><ArtistPartyReference>${artistReference}</ArtistPartyReference><DisplayArtistRole>MainArtist</DisplayArtistRole></DisplayArtist>${contributors}<Duration>${duration(track.duration)}</Duration><ParentalWarningType>${parentalWarning(track.explicitContent)}</ParentalWarningType></SoundRecording>`;
  }).join("");
  const coverId = snapshot.coverUrl ? coverAssetId(snapshot.coverUrl) : undefined;
  const coverImage = coverId && !takedown ? (() => {
    const asset = input.assets?.get(coverId);
    if (!asset) throw new Error("ERN_COVER_ASSET_METADATA_MISSING");
    if (!asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("ERN_COVER_ASSET_CHECKSUM_MISSING");
    if (asset.sizeBytes <= 0n) throw new Error("ERN_COVER_ASSET_SIZE_INVALID");
    const format = imageFormat(asset);
    const fileName = coverResourceFileName(snapshot, asset);
    return `<Image><ResourceReference>AImage1</ResourceReference><Type>FrontCoverImage</Type><ResourceId><ProprietaryId Namespace="${xml(sender.partyId)}">${xml(coverId)}</ProprietaryId></ResourceId><DisplayTitleText>${xml(snapshot.title)} cover</DisplayTitleText>${copyrightLine("CLine", snapshot.cLine)}<TechnicalDetails><TechnicalResourceDetailsReference>TImage1</TechnicalResourceDetailsReference><ImageCodecType>${format.codec}</ImageCodecType><File><URI>resources/${xml(fileName)}</URI><HashSum><Algorithm>SHA-256</Algorithm><HashSumValue>${asset.sha256}</HashSumValue></HashSum><FileSize>${fileSizeKilobytes(asset.sizeBytes)}</FileSize></File><IsProvidedInDelivery>true</IsProvidedInDelivery></TechnicalDetails></Image>`;
  })() : "";
  const releaseTypes = snapshot.format === "SINGLE" ? "<ReleaseType>SingleResourceRelease</ReleaseType><ReleaseType>Single</ReleaseType>" : `<ReleaseType>${snapshot.format === "EP" ? "EP" : "Album"}</ReleaseType>`;
  const mostRestrictiveWarning = snapshot.tracks.some(track => track.explicitContent === "EXPLICIT") ? "Explicit" : "NotExplicit";
  const compilation = snapshot.format === "COMPILATION"
    ? (new Set(snapshot.tracks.map(track => track.displayArtist ?? track.artist?.name ?? releaseArtistName)).size > 1 ? "<IsMultiArtistCompilation>true</IsMultiArtistCompilation>" : "<IsSingleArtistCompilation>true</IsSingleArtistCompilation>")
    : "";
  const release = `<Release><ReleaseReference>R0</ReleaseReference>${releaseTypes}<ReleaseId><ICPN>${xml(snapshot.ean)}</ICPN><ProprietaryId Namespace="${xml(sender.partyId)}">${xml(snapshot.id)}</ProprietaryId></ReleaseId>${displayTitle(snapshot.title)}<DisplayArtistName ApplicableTerritoryCode="Worldwide">${xml(snapshot.displayArtist)}</DisplayArtistName><DisplayArtist SequenceNumber="1"><ArtistPartyReference>P1</ArtistPartyReference><DisplayArtistRole>MainArtist</DisplayArtistRole></DisplayArtist><ReleaseLabelReference ApplicableTerritoryCode="Worldwide" IsDefault="true">PLabel</ReleaseLabelReference>${copyrightLine("PLine", snapshot.pLine)}${copyrightLine("CLine", snapshot.cLine)}<Duration>${duration(snapshot.tracks.reduce((total, track) => total + track.duration, 0))}</Duration><DisplayGenre ApplicableTerritoryCode="Worldwide"><GenreText>${xml(snapshot.genre)}</GenreText>${snapshot.subGenre ? `<SubGenre>${xml(snapshot.subGenre)}</SubGenre>` : ""}</DisplayGenre><ReleaseDate>${releaseDate}</ReleaseDate>${snapshot.originalReleaseDate ? `<OriginalReleaseDate>${xml(snapshot.originalReleaseDate)}</OriginalReleaseDate>` : ""}<ParentalWarningType>${mostRestrictiveWarning}</ParentalWarningType>${compilation}${releaseResourceGroup(snapshot, Boolean(coverImage))}</Release>`;
  const dealList = takedown ? "" : `<DealList><ReleaseDeal><DealReleaseReference>R0</DealReleaseReference><Deal><DealTerms>${dealTerritories(snapshot)}${dealValidity(snapshot)}<CommercialModelType>SubscriptionModel</CommercialModelType><CommercialModelType>AdvertisementSupportedModel</CommercialModelType><CommercialModelType>PayAsYouGoModel</CommercialModelType><UseType>OnDemandStream</UseType><UseType>NonInteractiveStream</UseType><UseType>PermanentDownload</UseType></DealTerms></Deal></ReleaseDeal></DealList>`;
  const created = createdAt.toISOString();
  const releaseProfile = snapshot.format === "SINGLE" ? "SimpleAudioSingle" : "Audio";
  return `<?xml version="1.0" encoding="UTF-8"?><ern:NewReleaseMessage xmlns:ern="http://ddex.net/xml/ern/432" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ddex.net/xml/ern/432 http://ddex.net/xml/ern/432/release-notification.xsd" ReleaseProfileVersionId="${releaseProfile}" LanguageAndScriptCode="${xml(snapshot.metaLanguage)}" AvsVersionId="${xml(avsVersionId)}"><MessageHeader><MessageThreadId>${xml(messageThreadId)}</MessageThreadId><MessageId>${xml(messageId)}</MessageId><MessageFileName>${xml(messageFileName)}</MessageFileName><MessageSender><PartyId>${xml(sender.partyId)}</PartyId>${partyName(sender.name)}</MessageSender><MessageRecipient><PartyId>${xml(recipient.partyId)}</PartyId>${partyName(recipient.name)}</MessageRecipient><MessageCreatedDateTime>${created}</MessageCreatedDateTime><MessageControlType>LiveMessage</MessageControlType></MessageHeader><PartyList>${artistParties}${labelParty}</PartyList><ResourceList>${soundRecordings}${coverImage}</ResourceList><ReleaseList>${release}</ReleaseList>${dealList}</ern:NewReleaseMessage>`;
}

export function snapshotHash(payload: unknown, ernXml: string): string {
  return createHash("sha256").update(JSON.stringify(payload)).update("\0").update(ernXml).digest("hex");
}

export async function validateAgainstXsd(xmlDocument: string, xsdPath?: string): Promise<void> {
  if (!xsdPath) throw new Error("ERN_XSD_PATH_REQUIRED");
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlDocument)) throw new Error("ERN_XML_DTD_FORBIDDEN");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("xmllint", ["--nonet", "--path", path.dirname(xsdPath), "--noout", "--schema", xsdPath, "-"], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("ERN_XSD_VALIDATION_TIMEOUT")); }, 15000);
    child.stderr.on("data", chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
    child.on("error", error => finish(error));
    child.on("close", code => finish(code === 0 ? undefined : new Error(`ERN_XSD_INVALID: ${stderr.slice(0, 1000)}`)));
    child.stdin.on("error", error => finish(error));
    child.stdin.end(xmlDocument);
  });
}
