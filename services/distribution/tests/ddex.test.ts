import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { acknowledgementOutcome, assertAcknowledgementMatches, parseAcknowledgement } from "../src/acknowledgement.js";
import { catalogSnapshotSchema, coverResourceFileName, generateErn, validateAgainstXsd, type CatalogSnapshot } from "../src/ern.js";

const sender = { partyId: "PADPIDA0000000001A", name: "BeAlpha" };
const recipient = { partyId: "PADPIDA1234567890A", name: "DSP" };
const messageId = "BA-77777777-7777-4777-8777-777777777777";
const snapshot: CatalogSnapshot = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Single",
  ean: "123456789012",
  type: "AUDIO",
  format: "SINGLE",
  status: "LOCKED_FOR_DELIVERY",
  tenantId: "33333333-3333-4333-8333-333333333333",
  displayArtist: "Artist",
  releaseDate: "2026-08-30T00:00:00.000Z",
  metaLanguage: "en",
  genre: "Pop",
  cLine: "2026 Label",
  pLine: "2026 Label",
  label: { name: "Label" },
  tracks: [{ id: "55555555-5555-4555-8555-555555555555", title: "Track", isrc: "USABC2600001", trackNumber: 1, discNumber: 1, duration: 180, displayArtist: "Artist", explicitContent: "NONE", audioAssetId: "88888888-8888-4888-8888-888888888888" }]
};

function ern(messageType: "NewReleaseMessage" | "TakedownMessage") {
  return generateErn({
    snapshot,
    sender,
    recipient,
    messageType,
    ernVersion: "4.3",
    avsVersionId: "9",
    messageId,
    messageThreadId: `BA-${snapshot.id}-spotify`,
    createdAt: new Date("2026-08-22T00:00:00.000Z"),
    assets: messageType === "TakedownMessage" ? new Map() : new Map([[snapshot.tracks[0]!.audioAssetId, { fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4000n }]])
  });
}

function acknowledgement(overrides: { acknowledgementMessageId?: string; referencedMessageId?: string; senderPartyId?: string; recipientPartyId?: string; releaseId?: string; supplyChainStatus?: string; fileStatus?: string; errorText?: string } = {}) {
  const acknowledgementMessageId = overrides.acknowledgementMessageId ?? "ACK-001";
  const referencedMessageId = overrides.referencedMessageId ?? messageId;
  const senderPartyId = overrides.senderPartyId ?? recipient.partyId;
  const recipientPartyId = overrides.recipientPartyId ?? sender.partyId;
  const releaseId = overrides.releaseId ?? snapshot.ean;
  const supplyChainStatus = overrides.supplyChainStatus ?? "SuccessfullyIngestedByReleaseDistributor";
  const fileStatus = overrides.fileStatus ?? "FileOK";
  return `<?xml version="1.0" encoding="UTF-8"?><ernc:AcknowledgementMessage xmlns:ernc="http://ddex.net/xml/ern-c-sftp/181" AvsVersionId="9"><MessageHeader><MessageThreadId>ACK-THREAD-001</MessageThreadId><MessageId>${acknowledgementMessageId}</MessageId><MessageFileName>ACK.xml</MessageFileName><MessageSender><PartyId>${senderPartyId}</PartyId></MessageSender><MessageRecipient><PartyId>${recipientPartyId}</PartyId></MessageRecipient><MessageCreatedDateTime>2026-08-22T00:00:00Z</MessageCreatedDateTime></MessageHeader><ReleaseStatus><ReleaseId><ICPN>${releaseId}</ICPN></ReleaseId><ReleaseStatus>${supplyChainStatus}</ReleaseStatus>${overrides.errorText ? `<ErrorText>${overrides.errorText}</ErrorText>` : ""}<Acknowledgement><MessageType>NewReleaseMessage</MessageType><MessageId>${referencedMessageId}</MessageId><MessageStatus><Status>${fileStatus}</Status></MessageStatus></Acknowledgement></ReleaseStatus></ernc:AcknowledgementMessage>`;
}

const xmllintAvailable = spawnSync("xmllint", ["--version"], { stdio: "ignore" }).status === 0;
if (process.env.CI && (!xmllintAvailable || !process.env.DISTRIBUTION_ERN_XSD_PATH || !process.env.DISTRIBUTION_ACK_XSD_PATH)) {
  throw new Error("DDEX_CI_XSD_REQUIRED: install xmllint and configure ERN/ACK schema paths");
}

describe("DDEX ERN 4.3.2 SimpleAudioSingle", () => {
  it("generates the identifiers, resource file and deal required for delivery", () => {
    const xml = ern("NewReleaseMessage");
    expect(xml).toContain('xmlns:ern="http://ddex.net/xml/ern/432"');
    expect(xml).toContain('ReleaseProfileVersionId="SimpleAudioSingle"');
    expect(xml).toContain(`<MessageId>${messageId}</MessageId>`);
    expect(xml).toContain("<ReleaseId><ICPN>123456789012</ICPN>");
    expect(xml).toContain("<ISRC>USABC2600001</ISRC>");
    expect(xml).toContain("<URI>resources/123456789012_T1_SoundRecording_001.wav</URI>");
    expect(xml).toContain("<DealList>");
  });

  it("represents a takedown without deals or binary technical details", () => {
    const xml = ern("TakedownMessage");
    expect(xml).toContain("<ern:NewReleaseMessage");
    expect(xml).not.toContain("<DealList>");
    expect(xml).not.toContain("<TechnicalDetails>");
    expect(xml).not.toContain("<DeliveryFile>");
  });

  it("describes and links the signed front-cover image with official technical details", () => {
    const coverAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const cover = { fileName: "cover.jpg", contentType: "image/jpeg", sizeBytes: 8192n, sha256: "a".repeat(64) };
    const xml = generateErn({
      snapshot: { ...snapshot, coverUrl: `media-asset:${coverAssetId}` }, sender, recipient,
      messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: "9", messageId,
      messageThreadId: `BA-${snapshot.id}-spotify`, createdAt: new Date("2026-08-22T00:00:00.000Z"),
      assets: new Map([[snapshot.tracks[0]!.audioAssetId, { fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4000n, sha256: "b".repeat(64) }], [coverAssetId, cover]])
    });
    expect(coverResourceFileName(snapshot, cover)).toBe("123456789012_FrontCoverImage_001.jpg");
    expect(xml).toContain("<Image><ResourceReference>AImage1</ResourceReference><Type>FrontCoverImage</Type>");
    expect(xml).toContain(`<ProprietaryId Namespace="${sender.partyId}">${coverAssetId}</ProprietaryId>`);
    expect(xml).toContain("<ImageCodecType>JPEG</ImageCodecType>");
    expect(xml).toContain("<URI>resources/123456789012_FrontCoverImage_001.jpg</URI>");
    expect(xml).toContain(`<HashSum><Algorithm>SHA-256</Algorithm><HashSumValue>${"a".repeat(64)}</HashSumValue></HashSum>`);
    expect(xml).toContain("<FileSize>8.192</FileSize>");
    expect(xml).toContain('<LinkedReleaseResourceReference LinkDescription="CoverArt">AImage1</LinkedReleaseResourceReference>');
  });

  it("fails closed for an opaque cover without matching signed image metadata", () => {
    expect(() => generateErn({
      snapshot: { ...snapshot, coverUrl: "media-asset:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, sender, recipient,
      messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: "9", messageId,
      messageThreadId: `BA-${snapshot.id}-spotify`, createdAt: new Date("2026-08-22T00:00:00.000Z"),
      assets: new Map([[snapshot.tracks[0]!.audioAssetId, { fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4000n }]])
    })).toThrow("ERN_COVER_ASSET_METADATA_MISSING");
  });

  it("serializes recording contributors, composition authors, ISWC and party identifiers", () => {
    const enriched = catalogSnapshotSchema.parse({
      ...snapshot,
      artist: { id: "11111111-1111-4111-8111-111111111111", name: "Artist", isni: "0000000121032683" },
      tracks: [{
        ...snapshot.tracks[0],
        producer: "Producer Name",
        remixer: { name: "Remixer Name", ipi: "00123456789" },
        contributors: {
          performers: [{ name: "Guitarist Name", role: "Musician", isni: "000000012281955X" }, { name: "Acoustic Player", role: "Acoustic Guitar" }],
          studioPersonnel: [{ name: "Mix Engineer", role: "MixingEngineer" }]
        },
        composition: {
          iswc: "T-123.456.789-0",
          authors: [
            { name: "Composer Name", role: "Composer", ipi: "00987654321" },
            { name: "Lyricist Name", role: "Lyricist" }
          ]
        }
      }]
    });
    const xml = generateErn({
      snapshot: enriched, sender, recipient, messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: "9", messageId,
      messageThreadId: `BA-${snapshot.id}-spotify`, createdAt: new Date("2026-08-22T00:00:00.000Z"),
      assets: new Map([[enriched.tracks[0]!.audioAssetId, { fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4000n }]])
    });
    expect(xml).toContain("<WorkId><ISWC>T1234567890</ISWC></WorkId>");
    expect(xml).toContain("<PartyName><FullName>Artist</FullName></PartyName><PartyId><ISNI>0000000121032683</ISNI></PartyId>");
    expect(xml).toContain("<PartyName><FullName>Remixer Name</FullName></PartyName><PartyId><IpiNameNumber>00123456789</IpiNameNumber></PartyId>");
    expect(xml).toContain("<PartyName><FullName>Composer Name</FullName></PartyName><PartyId><IpiNameNumber>00987654321</IpiNameNumber></PartyId>");
    expect(xml).toContain("<Role><Value>StudioProducer</Value></Role>");
    expect(xml).toContain("<Role><Value>Remixer</Value></Role>");
    expect(xml).toContain("<Role><Value>Musician</Value></Role>");
    expect(xml).toContain("<Role><Value>MixingEngineer</Value></Role>");
    expect(xml).toContain("<Role><Value>Composer</Value></Role>");
    expect(xml).toContain("<Role><Value>Lyricist</Value></Role>");
    expect(xml).toContain(`<Role><Value Namespace="${sender.partyId}" UserDefinedValue="Acoustic Guitar">UserDefined</Value></Role>`);
    expect(xml.match(/<Contributor SequenceNumber=/g)).toHaveLength(7);
  });

  it("uses supplied inclusion territories and validity end date", () => {
    const included = catalogSnapshotSchema.parse({ ...snapshot, territories: ["us", "GB"], validityEndDate: "2027-08-30" });
    const xml = generateErn({
      snapshot: included, sender, recipient, messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: "9", messageId,
      messageThreadId: `BA-${snapshot.id}-spotify`, createdAt: new Date("2026-08-22T00:00:00.000Z"),
      assets: new Map([[included.tracks[0]!.audioAssetId, { fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4000n }]])
    });
    expect(xml).toContain("<TerritoryCode>US</TerritoryCode><TerritoryCode>GB</TerritoryCode>");
    expect(xml).toContain("<EndDateTime>2027-08-30T23:59:59Z</EndDateTime>");
    expect(xml).not.toContain("<ExcludedTerritoryCode>");
  });

  it("uses supplied exclusions and preserves worldwide open-ended defaults when absent", () => {
    const excluded = catalogSnapshotSchema.parse({ ...snapshot, metadata: { excludingTerritories: ["US", "ca"], targetDsps: ["spotify"] } });
    const xml = generateErn({
      snapshot: excluded, sender, recipient, messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: "9", messageId,
      messageThreadId: `BA-${snapshot.id}-spotify`, createdAt: new Date("2026-08-22T00:00:00.000Z"),
      assets: new Map([[excluded.tracks[0]!.audioAssetId, { fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4000n }]])
    });
    expect(xml).toContain("<ExcludedTerritoryCode>US</ExcludedTerritoryCode><ExcludedTerritoryCode>CA</ExcludedTerritoryCode>");
    expect(xml).not.toContain("<TerritoryCode>Worldwide</TerritoryCode>");
    expect(ern("NewReleaseMessage")).toContain("<TerritoryCode>Worldwide</TerritoryCode><ValidityPeriod><StartDateTime>2026-08-30T00:00:00.000Z</StartDateTime></ValidityPeriod>");
    expect(ern("NewReleaseMessage")).not.toContain("<EndDateTime>");
  });

  it("rejects simultaneous inclusion and exclusion territories", () => {
    expect(() => catalogSnapshotSchema.parse({ ...snapshot, territories: ["US"], excludingTerritories: ["CA"] })).toThrow("mutually exclusive");
  });

  it.runIf(Boolean(process.env.DISTRIBUTION_ERN_XSD_PATH) && xmllintAvailable)("validates against the licensed official ERN XSD when configured", async () => {
    await expect(validateAgainstXsd(ern("NewReleaseMessage"), process.env.DISTRIBUTION_ERN_XSD_PATH)).resolves.toBeUndefined();
  });
});

describe("DDEX ERN 4.3.2 Audio profile", () => {
  const multiTrackSnapshot: CatalogSnapshot = {
    ...snapshot,
    title: "Multi-track release",
    format: "ALBUM",
    tracks: [
      snapshot.tracks[0]!,
      { ...snapshot.tracks[0]!, id: "66666666-6666-4666-8666-666666666666", title: "Track Two", isrc: "USABC2600002", trackNumber: 2, audioAssetId: "99999999-9999-4999-8999-999999999999" },
      { ...snapshot.tracks[0]!, id: "77777777-7777-4777-8777-777777777777", title: "Disc Two", isrc: "USABC2600003", discNumber: 2, trackNumber: 1, audioAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    ]
  };

  function multiErn(format: "EP" | "ALBUM" | "COMPILATION" = "ALBUM") {
    const value = { ...multiTrackSnapshot, format };
    return generateErn({
      snapshot: value,
      sender,
      recipient,
      messageType: "NewReleaseMessage",
      ernVersion: "4.3",
      avsVersionId: "9",
      messageId,
      messageThreadId: `BA-${value.id}-spotify`,
      createdAt: new Date("2026-08-22T00:00:00.000Z"),
      assets: new Map(value.tracks.map((track, index) => [track.audioAssetId, { fileName: `master-${index + 1}.wav`, contentType: "audio/wav", sizeBytes: 4000n }]))
    });
  }

  it.each(["EP", "ALBUM", "COMPILATION"] as const)("generates all resources and disc sequencing for %s", format => {
    const xml = multiErn(format);
    expect(xml).toContain('ReleaseProfileVersionId="Audio"');
    expect(xml.match(/<SoundRecording>/g)).toHaveLength(3);
    expect(xml).toContain("<ISRC>USABC2600003</ISRC>");
    expect(xml).toContain("resources/123456789012_T3_SoundRecording_003.wav");
    expect(xml).toContain('<ResourceGroup ResourceGroupType="Component"><SequenceNumber>2</SequenceNumber>');
    expect(xml).toContain(format === "EP" ? "<ReleaseType>EP</ReleaseType>" : "<ReleaseType>Album</ReleaseType>");
    expect(xml).toContain(format === "COMPILATION" ? "<IsSingleArtistCompilation>true</IsSingleArtistCompilation>" : "</Release>");
  });

  it.runIf(Boolean(process.env.DISTRIBUTION_ERN_XSD_PATH) && xmllintAvailable)("validates a multi-track Audio profile against the official ERN XSD", async () => {
    await expect(validateAgainstXsd(multiErn(), process.env.DISTRIBUTION_ERN_XSD_PATH)).resolves.toBeUndefined();
  });
});

describe("DDEX ERN-C acknowledgements", () => {
  it("accepts a matching success acknowledgement", () => {
    const parsed = parseAcknowledgement(acknowledgement());
    expect(() => assertAcknowledgementMatches(parsed, { fileName: `ACK_${messageId}_20260822000000000.xml`, messageId, releaseId: snapshot.ean, senderPartyId: recipient.partyId, recipientPartyId: sender.partyId })).not.toThrow();
    expect(acknowledgementOutcome(parsed)).toBe("CONFIRMED");
  });

  it("maps a DSP validation error to a failed delivery", () => {
    const parsed = parseAcknowledgement(acknowledgement({ supplyChainStatus: "ProcessingErrorAtReleaseDistributor", fileStatus: "MetadataMissing", errorText: "Missing contributor role" }));
    expect(acknowledgementOutcome(parsed)).toBe("FAILED");
    expect(parsed.errorText).toBe("Missing contributor role");
  });

  it("rejects acknowledgements from the wrong sender or for another message", () => {
    const expected = { fileName: `ACK_${messageId}_20260822000000000.xml`, messageId, releaseId: snapshot.ean, senderPartyId: recipient.partyId, recipientPartyId: sender.partyId };
    expect(() => assertAcknowledgementMatches(parseAcknowledgement(acknowledgement({ senderPartyId: "PADPIDA9999999999A" })), expected)).toThrow("DDEX_ACK_SENDER_MISMATCH");
    expect(() => assertAcknowledgementMatches(parseAcknowledgement(acknowledgement({ referencedMessageId: "BA-OTHER" })), expected)).toThrow("DDEX_ACK_MESSAGE_MISMATCH");
  });

  it("rejects DTD/entity payloads before parsing", () => {
    expect(() => parseAcknowledgement(`<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]>${acknowledgement()}`)).toThrow("DDEX_ACK_DTD_FORBIDDEN");
  });

  it.runIf(Boolean(process.env.DISTRIBUTION_ACK_XSD_PATH) && xmllintAvailable)("validates against the licensed official ERN-C XSD when configured", async () => {
    await expect(validateAgainstXsd(acknowledgement(), process.env.DISTRIBUTION_ACK_XSD_PATH)).resolves.toBeUndefined();
  });
});
