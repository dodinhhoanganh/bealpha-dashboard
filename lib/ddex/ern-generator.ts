/**
 * DDEX ERN 4.3 (Electronic Release Notification) Generator
 *
 * Generates compliant ERN XML for music distribution to DSPs.
 * Reference: https://kb.ddex.net/implementing-each-standard/electronic-release-notification-message-suite-(ern)
 */

interface ERNRelease {
  id: string;
  title: string;
  titleLocalized?: Array<{ language: string; value: string }> | null;
  subtitle?: string | null;
  subtitleLocalized?: Array<{ language: string; value: string }> | null;
  ean?: string | null;
  grid?: string | null;
  catalogueNumber?: string | null;
  type: string;
  format: string;
  genre?: string | null;
  subGenre?: string | null;
  releaseDate: Date | string;
  originalReleaseDate?: Date | string | null;
  metaLanguage?: string | null;
  displayArtist?: string | null;
  pLine?: string | null;
  cLine?: string | null;
  pLineYear?: number | null;
  cLineYear?: number | null;
  coverUrl?: string | null;
  territories?: string | null;
  excludingTerritories?: string | null;
  artist?: {
    id: string;
    name: string;
    spotifyId?: string | null;
    appleMusicId?: string | null;
    vevoChannel?: string | null;
  } | null;
  label?: { id: string; name: string } | null;
}

interface ERNTrack {
  id: string;
  title: string;
  titleLocalized?: Array<{ language: string; value: string }> | null;
  subtitle?: string | null;
  subtitleLocalized?: Array<{ language: string; value: string }> | null;
  isrc?: string | null;
  trackNumber: number;
  discNumber: number;
  duration?: number | null;
  genre?: string | null;
  parentalWarningType: string;
  displayArtist?: string | null;
  producer?: string | null;
  remixer?: string | null;
  territories?: string | null;
  pitchingNote?: string | null;
  canvasAsset?: ERNAsset | null;
  motionAsset?: ERNAsset | null;
  artist?: { 
    id: string; 
    name: string;
    vevoChannel?: string | null;
  } | null;
  audioAsset?: ERNAsset | null;
  iswc?: string | null;
  snippetStart?: number | null;
  snippetEnd?: number | null;
  contributors?: Array<{
    name?: string | null;
    role: string;
    share?: any;
    artist?: {
      id: string;
      name: string;
      ipi?: string | null;
      isni?: string | null;
      dpid?: string | null;
    } | null;
  }>;
  composition?: {
    authors?: any;
  } | null;
}

interface ERNAsset {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | bigint | null;
  mimeType?: string | null;
  duration?: number | null;
  sampleRate?: number | null;
  bitRate?: number | null;
  channels?: number | null;
  codec?: string | null;
  isrc?: string | null;
  resourceReference?: string | null;
}

// XML escaping
function escXml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().split("T")[0];
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "PT0S";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  let iso = "PT";
  if (h > 0) iso += `${h}H`;
  if (m > 0) iso += `${m}M`;
  iso += `${s}S`;
  return iso;
}

interface ERNOptions {
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  messageId?: string;
  onBehalfOfId?: string;
  onBehalfOfName?: string;
}

const DEFAULT_OPTIONS: ERNOptions = {
  senderId: "PADPIDA2024010101A",
  senderName: "BeAlpha Music",
  recipientId: "",
  recipientName: "",
};

interface PartyEntry {
  ref: string;
  name: string;
  ipi?: string | null;
  isni?: string | null;
  dpid?: string | null;
  vevoChannel?: string | null;
  roles: string[];
}

function buildPartyList(
  release: ERNRelease,
  tracks: ERNTrack[],
  opts: ERNOptions,
): { xml: string; getRef: (n: string, i?: string | null) => string } {
  const partyMap = new Map<string, PartyEntry>();
  let counter = 1;

  function addParty(
    name: any,
    ipi?: any,
    isni?: any,
    dpid?: any,
    role?: string,
    vevoChannel?: any,
  ): string {
    const safeName = String(name || "").trim();
    const safeIpi = ipi ? String(ipi).trim() : null;
    const key = (safeIpi || safeName).toLowerCase();
    const existing = partyMap.get(key);
    if (existing) {
      if (role && !existing.roles.includes(role)) existing.roles.push(role);
      return existing.ref;
    }
    const ref = `P${counter++}`;
    partyMap.set(key, {
      ref,
      name: safeName,
      ipi: safeIpi,
      isni: isni ? String(isni) : null,
      dpid: dpid ? String(dpid) : null,
      vevoChannel: vevoChannel ? String(vevoChannel) : null,
      roles: role ? [role] : [],
    });
    return ref;
  }

  // Sender
  addParty(opts.senderName, null, null, opts.senderId, "MessageSender");
  // Label
  if (release.label)
    addParty(release.label.name, null, null, null, "RecordLabel");
  // Main artist
  const mainArtistName = release.displayArtist || release.artist?.name;
  if (mainArtistName) addParty(mainArtistName, null, null, null, "MainArtist", release.artist?.vevoChannel);
  // Track-level parties
  for (const track of tracks) {
    const trackArtist = track.displayArtist || track.artist?.name;
    if (trackArtist) addParty(trackArtist, null, null, null, "MainArtist", track.artist?.vevoChannel);
    if (track.contributors && Array.isArray(track.contributors)) {
      for (const c of track.contributors) {
        const name = c.artist?.name || c.name;
        if (name)
          addParty(
            name,
            c.artist?.ipi,
            c.artist?.isni,
            c.artist?.dpid,
            mapRole(c.role),
          );
      }
    }

    let authors: any[] = [];
    if (track.composition?.authors) {
      if (typeof track.composition.authors === "string") {
        try {
          authors = JSON.parse(track.composition.authors);
        } catch (e) {}
      } else if (Array.isArray(track.composition.authors)) {
        authors = track.composition.authors;
      }
    }
    if (!Array.isArray(authors)) authors = [];

    for (const s of authors) {
      addParty(
        s.name,
        s.ipiNameNumber || s.ipi,
        null,
        null,
        s.role || "Author",
      );
      if (s.publisher?.name) {
        addParty(
          s.publisher.name,
          s.publisher.ipiNameNumber || s.publisher.ipi,
          null,
          null,
          "MusicPublisher",
        );
      }
    }
  }

  let xml = "";
  for (const party of partyMap.values()) {
    xml += `
    <Party>
      <PartyReference>${escXml(party.ref)}</PartyReference>`;
    if (party.ipi) {
      xml += `
      <PartyId>
        <IpiNameNumber>${escXml(party.ipi)}</IpiNameNumber>
      </PartyId>`;
    }
    if (party.isni) {
      xml += `
      <PartyId>
        <ISNI>${escXml(party.isni)}</ISNI>
      </PartyId>`;
    }
    if (party.dpid) {
      xml += `
      <PartyId>
        <DPID>${escXml(party.dpid)}</DPID>
      </PartyId>`;
    }
    if (party.vevoChannel) {
      // ERN 4.x: ProprietaryId with Namespace="Channel"
      xml += `
      <PartyId>
        <ProprietaryId Namespace="Channel">${escXml(party.vevoChannel)}</ProprietaryId>
      </PartyId>`;
      // NOTE: ArtistProfilePage/PageName was ERN 3.8 syntax — removed for ERN 4.3 compliance
    }
    xml += `
      <PartyName>
        <FullName>${escXml(party.name)}</FullName>
      </PartyName>
    </Party>`;
  }
  return {
    xml,
    getRef: (n: string, i?: string | null) =>
      partyMap.get((i || n).toLowerCase().trim())?.ref || "",
  };
}

function validateISRC(isrc: string): boolean {
  const stripped = isrc.replace(/-/g, "");
  return /^[A-Z]{2}\w{3}\d{7}$/.test(stripped);
}

// ISWC format: T-NNN.NNN.NNN-C
function validateISWC(iswc: string): boolean {
  return /^T-?\d{3}\.?\d{3}\.?\d{3}-?\d$/.test(iswc);
}

// EAN/UPC: 12 or 13 digits with GS1 Modulo-10 check digit (spec §4.2)
function validateEAN(ean: string): boolean {
  if (!/^\d{12,13}$/.test(ean)) return false;
  // Pad UPC-12 to EAN-13 for uniform check
  const digits = ean.padStart(13, "0");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits[i]);
    // Positions 0-indexed: even positions weight 1, odd positions weight 3
    sum += i % 2 === 0 ? d : d * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[12]);
}

function generateTitleBlocks(
  title: string,
  subtitle: string | null | undefined,
  titleLocalized: Array<{ language: string; value: string }> | null | undefined,
  subtitleLocalized:
    | Array<{ language: string; value: string }>
    | null
    | undefined,
): string {
  let xml = "";
  const localizedData = new Map<
    string,
    { title?: string; subtitle?: string }
  >();

  if (titleLocalized && Array.isArray(titleLocalized)) {
    for (const loc of titleLocalized) {
      if (loc.value) {
        const lang = loc.language || "en";
        if (!localizedData.has(lang)) localizedData.set(lang, {});
        localizedData.get(lang)!.title = loc.value;
      }
    }
  }

  if (subtitleLocalized && Array.isArray(subtitleLocalized)) {
    for (const loc of subtitleLocalized) {
      if (loc.value) {
        const lang = loc.language || "en";
        if (!localizedData.has(lang)) localizedData.set(lang, {});
        localizedData.get(lang)!.subtitle = loc.value;
      }
    }
  }

  xml += `
        <Title TitleType="FormalTitle">
          <TitleText>${escXml(title)}</TitleText>`;
  if (subtitle) {
    xml += `
          <SubTitle>${escXml(subtitle)}</SubTitle>`;
  }
  xml += `
        </Title>`;

  for (const [lang, data] of localizedData.entries()) {
    xml += `
        <Title TitleType="FormalTitle" LanguageAndScriptCode="${escXml(lang)}">
          <TitleText>${escXml(data.title || title)}</TitleText>`;
    if (data.subtitle || subtitle) {
      xml += `
          <SubTitle>${escXml(data.subtitle || subtitle)}</SubTitle>`;
    }
    xml += `
        </Title>`;
  }

  return xml;
}

/**
 * Generate DDEX ERN 4.3 XML for a release
 */
export function generateERN(
  release: ERNRelease,
  tracks: ERNTrack[],
  assets: ERNAsset[],
  options: Partial<ERNOptions> = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const messageId = opts.messageId || `MSG-${release.id}-${Date.now()}`;
  const now = new Date().toISOString();
  const territories = release.territories?.split(",").map((t) => t.trim()) || [
    "Worldwide",
  ];

  const partyListObj = buildPartyList(release, tracks, opts);

  // Build resource references map
  const isVideoRelease = release.type === "VIDEO";
  const refPrefix = isVideoRelease ? "V" : "A";

  const resourceRefs: Record<string, string> = {};
  assets.forEach((asset, i) => {
    resourceRefs[asset.id] = asset.resourceReference || `${refPrefix}${i + 1}`;
  });
  tracks.forEach((track, i) => {
    const mainAsset = isVideoRelease ? track.motionAsset : track.audioAsset;
    if (mainAsset) {
      resourceRefs[track.id] = resourceRefs[mainAsset.id] || `${refPrefix}${i + 1}`;
    }
  });

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ern:NewReleaseMessage
  xmlns:ern="http://ddex.net/xml/ern/43"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://ddex.net/xml/ern/43 http://ddex.net/xml/ern/43/release-notification.xsd"
  MessageSchemaVersionId="ern/43"
  LanguageAndScriptCode="${escXml(release.metaLanguage || "en")}">

  <!-- MESSAGE HEADER -->
  <MessageHeader>
    <MessageThreadId>${escXml(messageId)}</MessageThreadId>
    <MessageId>${escXml(messageId)}</MessageId>
    <MessageSender>
      <PartyId>${escXml(opts.senderId)}</PartyId>
      <PartyName>
        <FullName>${escXml(opts.senderName)}</FullName>
      </PartyName>
    </MessageSender>`;

  if (opts.onBehalfOfId || release.label) {
    xml += `
    <SentOnBehalfOf>
      <PartyId>${escXml(opts.onBehalfOfId || release.label?.id || "")}</PartyId>
      <PartyName>
        <FullName>${escXml(opts.onBehalfOfName || release.label?.name || "")}</FullName>
      </PartyName>
    </SentOnBehalfOf>`;
  }

  xml += `
    <MessageRecipient>
      <PartyId>${escXml(opts.recipientId)}</PartyId>
      <PartyName>
        <FullName>${escXml(opts.recipientName)}</FullName>
      </PartyName>
    </MessageRecipient>
    <MessageCreatedDateTime>${now}</MessageCreatedDateTime>
  </MessageHeader>

  <!-- PARTY LIST (ERN 4.3 — centralized party declarations) -->
  <PartyList>${partyListObj.xml}</PartyList>

  <!-- RESOURCE LIST -->
  <ResourceList>`;

  // Image resource (cover art)
  if (release.coverUrl) {
    xml += `
    <Image>
      <Type>FrontCoverImage</Type>
      <ImageId>
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">IMG-${escXml(release.id)}</ProprietaryId>
      </ImageId>
      <ResourceReference>A0</ResourceReference>
      <ImageDetailsByTerritory>
        <TerritoryCode>Worldwide</TerritoryCode>
        <TechnicalImageDetails>
          <TechnicalResourceDetailsReference>T0</TechnicalResourceDetailsReference>
          <File>
            <URI>${escXml(release.coverUrl)}</URI>
          </File>
        </TechnicalImageDetails>
      </ImageDetailsByTerritory>
    </Image>`;
  }

  // Resources (Sound recordings or Videos)
  const resourceTag = isVideoRelease ? "Video" : "SoundRecording";
  const resourceType = isVideoRelease ? "MusicVideo" : "MusicalWorkSoundRecording";
  const idTag = isVideoRelease ? "VideoId" : "SoundRecordingId";
  const detailsTag = isVideoRelease ? "VideoDetailsByTerritory" : "SoundRecordingDetailsByTerritory";
  const techTag = isVideoRelease ? "TechnicalVideoDetails" : "TechnicalSoundRecordingDetails";

  for (const track of tracks) {
    const mainAsset = isVideoRelease ? track.motionAsset : track.audioAsset;
    const ref = mainAsset
      ? resourceRefs[mainAsset.id] || `${refPrefix}${track.trackNumber}`
      : `${refPrefix}${track.trackNumber}`;
    const artistName =
      track.displayArtist ||
      track.artist?.name ||
      release.displayArtist ||
      release.artist?.name ||
      "Unknown";

    xml += `
    <${resourceTag}>
      <Type>${resourceType}</Type>
      <${idTag}>`;

    if (track.isrc) {
      xml += `
        <ISRC>${escXml(track.isrc)}</ISRC>`;
    }
    xml += `
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">${escXml(track.id)}</ProprietaryId>
      </${idTag}>
      <ResourceReference>${escXml(ref)}</ResourceReference>
      <ReferenceTitle>
        <TitleText>${escXml(track.title)}</TitleText>`;
    if (track.subtitle) {
      xml += `
        <SubTitle>${escXml(track.subtitle)}</SubTitle>`;
    }
    xml += `
      </ReferenceTitle>
      <Duration>${formatDuration(track.duration || mainAsset?.duration)}</Duration>
      <${detailsTag}>`;

    for (const territory of territories) {
      xml += `
        <TerritoryCode>${escXml(territory)}</TerritoryCode>`;
    }

    xml += generateTitleBlocks(
      track.title,
      track.subtitle,
      track.titleLocalized,
      track.subtitleLocalized,
    );

    xml += `
        <DisplayArtist SequenceNumber="1">
          <PartyReference>${escXml(partyListObj.getRef(artistName))}</PartyReference>
          <DisplayArtistRole>MainArtist</DisplayArtistRole>
        </DisplayArtist>`;

    // Featured artists & Contributors
    let featuredIdx = 2;
    if (track.contributors && Array.isArray(track.contributors)) {
      for (const c of track.contributors) {
        const name = c.artist?.name || c.name;
        if (!name) continue;
        const ref = partyListObj.getRef(name, c.artist?.ipi);
        if (c.role === "FeaturedArtist") {
          xml += `
        <DisplayArtist SequenceNumber="${featuredIdx++}">
          <PartyReference>${escXml(ref)}</PartyReference>
          <DisplayArtistRole>FeaturedArtist</DisplayArtistRole>
        </DisplayArtist>`;
        } else {
          xml += `
        <ResourceContributor>
          <PartyReference>${escXml(ref)}</PartyReference>
          <ResourceContributorRole>${escXml(mapRole(c.role))}</ResourceContributorRole>
        </ResourceContributor>`;
        }
      }
    }

    // Splits (Writers and Publishers)
    let authors: any[] = [];
    if (track.composition?.authors) {
      if (typeof track.composition.authors === "string") {
        try {
          authors = JSON.parse(track.composition.authors);
        } catch (e) {}
      } else if (Array.isArray(track.composition.authors)) {
        authors = track.composition.authors;
      }
    }
    if (!Array.isArray(authors)) authors = [];

    if (authors.length > 0) {
      for (const split of authors) {
        const wRef = partyListObj.getRef(
          split.name,
          split.ipiNameNumber || split.ipi,
        );
        xml += `
        <IndirectResourceContributor>
          <PartyReference>${escXml(wRef)}</PartyReference>
          <IndirectResourceContributorRole>${escXml(mapRole(split.role || "Author"))}</IndirectResourceContributorRole>
        </IndirectResourceContributor>`;

        if (split.publisher?.name) {
          const pRef = partyListObj.getRef(
            split.publisher.name,
            split.publisher.ipiNameNumber || split.publisher.ipi,
          );
          xml += `
        <IndirectResourceContributor>
          <PartyReference>${escXml(pRef)}</PartyReference>
          <IndirectResourceContributorRole>MusicPublisher</IndirectResourceContributorRole>
        </IndirectResourceContributor>`;
        }
      }
    }

    if (track.producer) {
      xml += `
        <ResourceContributor>
          <PartyReference>${escXml(partyListObj.getRef(track.producer))}</PartyReference>
          <ResourceContributorRole>Producer</ResourceContributorRole>
        </ResourceContributor>`;
    }

    if (release.pLine) {
      xml += `
        <PLine>
          <Year>${release.pLineYear || new Date().getFullYear()}</Year>
          <PLineText>${escXml(release.pLine)}</PLineText>
        </PLine>`;
    }

    if (track.genre || release.genre) {
      xml += `
        <Genre>
          <GenreText>${escXml(track.genre || release.genre || "")}</GenreText>`;
      if (release.subGenre) {
        xml += `
          <SubGenre>${escXml(release.subGenre)}</SubGenre>`;
      }
      xml += `
        </Genre>`;
    }

    xml += `
        <ParentalWarningType>${escXml(track.parentalWarningType)}</ParentalWarningType>`;

    // Technical details
    if (mainAsset) {
      xml += `
        <${techTag}>
          <TechnicalResourceDetailsReference>T-${escXml(track.id)}</TechnicalResourceDetailsReference>`;
          
      if (isVideoRelease) {
        if (mainAsset.codec) {
          xml += `
          <VideoCodecType>${escXml(mapCodec(mainAsset.codec))}</VideoCodecType>`;
        }
        if (mainAsset.bitRate) {
          xml += `
          <VideoBitRate>${escXml(mainAsset.bitRate)}</VideoBitRate>`;
        }
      } else {
        if (mainAsset.codec) {
          xml += `
          <AudioCodecType>${escXml(mapCodec(mainAsset.codec))}</AudioCodecType>`;
        }
        if (mainAsset.channels) {
          xml += `
          <NumberOfChannels>${escXml(mainAsset.channels)}</NumberOfChannels>`;
        }
        if (mainAsset.sampleRate) {
          xml += `
          <SamplingRate>${escXml(mainAsset.sampleRate)}</SamplingRate>`;
        }
        if (mainAsset.bitRate) {
          xml += `
          <BitRate>${escXml(mainAsset.bitRate)}</BitRate>`;
        }
      }
      
      xml += `
          <Duration>${formatDuration(mainAsset.duration)}</Duration>
          <File>
            <FileName>${escXml(mainAsset.fileName)}</FileName>
            <URI>${escXml(mainAsset.fileUrl)}</URI>`;
      if (mainAsset.fileSize) {
        xml += `
            <FileSize>${escXml(Number(mainAsset.fileSize))}</FileSize>`;
      }
      xml += `
          </File>`;
          
      if (track.snippetStart !== undefined && track.snippetStart !== null) {
        xml += `
          <ClipDetails>
            <ClipType>Preview</ClipType>
            <StartTime>PT${track.snippetStart}S</StartTime>`;
        if (track.snippetEnd !== undefined && track.snippetEnd !== null) {
          const clipDuration = track.snippetEnd - track.snippetStart;
          if (clipDuration > 0) {
            xml += `
            <Duration>PT${clipDuration}S</Duration>`;
          }
        }
        xml += `
          </ClipDetails>`;
      }
      
      if (!isVideoRelease) {
        if (track.canvasAsset) {
          xml += `
          <ClipDetails>
            <ClipType>LoopedVisual</ClipType>
            <ClipResourceReference>V-${track.id}-CANVAS</ClipResourceReference>
          </ClipDetails>`;
        }
        if (track.motionAsset) {
          xml += `
          <ClipDetails>
            <ClipType>MotionArtwork</ClipType>
            <ClipResourceReference>V-${track.id}-MOTION</ClipResourceReference>
          </ClipDetails>`;
        }
      }
      
      xml += `
        </${techTag}>`;
    }

    if (track.pitchingNote) {
      xml += `
        <MarketingComment>${escXml(track.pitchingNote)}</MarketingComment>`;
    }

    xml += `
      </${detailsTag}>
    </${resourceTag}>`;
  }

  // Musical Works (Compositions)
  for (const track of tracks) {
    let authors: any[] = [];
    if (track.composition?.authors) {
      if (typeof track.composition.authors === "string") {
        try {
          authors = JSON.parse(track.composition.authors);
        } catch (e) {}
      } else if (Array.isArray(track.composition.authors)) {
        authors = track.composition.authors;
      }
    }
    if (!Array.isArray(authors)) authors = [];

    if (track.iswc || authors.length > 0) {
      xml += `
    <MusicalWork>
      <MusicalWorkId>`;
      if (track.iswc) {
        xml += `
        <ISWC>${escXml(track.iswc)}</ISWC>`;
      }
      xml += `
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">MW-${escXml(track.id)}</ProprietaryId>
      </MusicalWorkId>
      <ReferenceTitle>
        <TitleText>${escXml(track.title)}</TitleText>
      </ReferenceTitle>`;

      if (authors.length > 0) {
        for (const split of authors) {
          const wRef = partyListObj.getRef(
            split.name,
            split.ipiNameNumber || split.ipi,
          );
          xml += `
      <MusicalWorkContributor>
        <PartyReference>${escXml(wRef)}</PartyReference>
        <MusicalWorkContributorRole>${escXml(mapRole(split.role || "Author"))}</MusicalWorkContributorRole>
      </MusicalWorkContributor>`;

          if (split.publisher?.name) {
            const pRef = partyListObj.getRef(
              split.publisher.name,
              split.publisher.ipiNameNumber || split.publisher.ipi,
            );
            xml += `
      <MusicalWorkContributor>
        <PartyReference>${escXml(pRef)}</PartyReference>
        <MusicalWorkContributorRole>MusicPublisher</MusicalWorkContributorRole>
      </MusicalWorkContributor>`;
          }
        }
      }
      xml += `
    </MusicalWork>`;
    }

    // Video resources for Canvas/Motion
    if (track.canvasAsset) {
      xml += `
    <Video>
      <Type>ShortFormVideo</Type>
      <VideoId>
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">VC-${escXml(track.id)}</ProprietaryId>
      </VideoId>
      <ResourceReference>V-${track.id}-CANVAS</ResourceReference>
      <ReferenceTitle>
        <TitleText>${escXml(track.title)} (Canvas)</TitleText>
      </ReferenceTitle>
      <Duration>${formatDuration(track.canvasAsset.duration)}</Duration>
      <VideoDetailsByTerritory>
        <TerritoryCode>Worldwide</TerritoryCode>
        <TechnicalVideoDetails>
          <TechnicalResourceDetailsReference>TV-${escXml(track.id)}-CANVAS</TechnicalResourceDetailsReference>
          <File>
            <FileName>${escXml(track.canvasAsset.fileName)}</FileName>
            <URI>${escXml(track.canvasAsset.fileUrl)}</URI>
          </File>
        </TechnicalVideoDetails>
      </VideoDetailsByTerritory>
    </Video>`;
    }

    if (track.motionAsset && !isVideoRelease) {
      xml += `
    <Video>
      <Type>VideoAlbumArtwork</Type>
      <VideoId>
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">VM-${escXml(track.id)}</ProprietaryId>
      </VideoId>
      <ResourceReference>V-${track.id}-MOTION</ResourceReference>
      <ReferenceTitle>
        <TitleText>${escXml(track.title)} (Motion)</TitleText>
      </ReferenceTitle>
      <Duration>${formatDuration(track.motionAsset.duration)}</Duration>
      <VideoDetailsByTerritory>
        <TerritoryCode>Worldwide</TerritoryCode>
        <TechnicalVideoDetails>
          <TechnicalResourceDetailsReference>TV-${escXml(track.id)}-MOTION</TechnicalResourceDetailsReference>
          <File>
            <FileName>${escXml(track.motionAsset.fileName)}</FileName>
            <URI>${escXml(track.motionAsset.fileUrl)}</URI>
          </File>
        </TechnicalVideoDetails>
      </VideoDetailsByTerritory>
    </Video>`;
    }
  }

  xml += `
  </ResourceList>

  <!-- RELEASE LIST -->
  <ReleaseList>
    <Release IsMainRelease="true">
      <ReleaseReference>R0</ReleaseReference>
      <ReleaseId>`;

  if (release.ean) {
    xml += `
        <ICPN>${escXml(release.ean)}</ICPN>`;
  }
  if (release.grid) {
    xml += `
        <GRid>${escXml(release.grid)}</GRid>`;
  }
  if (release.catalogueNumber) {
    xml += `
        <CatalogNumber>${escXml(release.catalogueNumber)}</CatalogNumber>`;
  }
  xml += `
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">${escXml(release.id)}</ProprietaryId>
      </ReleaseId>
      <ReferenceTitle>
        <TitleText>${escXml(release.title)}</TitleText>`;
  if (release.subtitle) {
    xml += `
        <SubTitle>${escXml(release.subtitle)}</SubTitle>`;
  }
  xml += `
      </ReferenceTitle>
      <ReleaseResourceReferenceList>`;

  if (release.coverUrl) {
    xml += `
        <ReleaseResourceReference ReleaseResourceType="PrimaryResource">A0</ReleaseResourceReference>`;
  }

  for (const track of tracks) {
    const mainAsset = isVideoRelease ? track.motionAsset : track.audioAsset;
    const ref = mainAsset
      ? resourceRefs[mainAsset.id] || `${refPrefix}${track.trackNumber}`
      : `${refPrefix}${track.trackNumber}`;
    xml += `
        <ReleaseResourceReference ReleaseResourceType="PrimaryResource">${escXml(ref)}</ReleaseResourceReference>`;
    
    if (!isVideoRelease) {
      if (track.canvasAsset) {
        xml += `
        <ReleaseResourceReference ReleaseResourceType="SecondaryResource">V-${track.id}-CANVAS</ReleaseResourceReference>`;
      }
      if (track.motionAsset) {
        xml += `
        <ReleaseResourceReference ReleaseResourceType="SecondaryResource">V-${track.id}-MOTION</ReleaseResourceReference>`;
      }
    }
  }

  xml += `
      </ReleaseResourceReferenceList>
      <ReleaseType>${escXml(mapReleaseType(release.format))}</ReleaseType>
      <ReleaseDetailsByTerritory>`;

  for (const territory of territories) {
    xml += `
        <TerritoryCode>${escXml(territory)}</TerritoryCode>`;
  }

  const mainArtistName =
    release.displayArtist || release.artist?.name || "Unknown";
  xml += `
        <DisplayArtistName>${escXml(mainArtistName)}</DisplayArtistName>`;

  if (release.label) {
    xml += `
        <LabelName>${escXml(release.label.name)}</LabelName>`;
  }

  xml += generateTitleBlocks(
    release.title,
    release.subtitle,
    release.titleLocalized,
    release.subtitleLocalized,
  );

  if (release.genre) {
    xml += `
        <Genre>
          <GenreText>${escXml(release.genre)}</GenreText>`;
    if (release.subGenre) {
      xml += `
          <SubGenre>${escXml(release.subGenre)}</SubGenre>`;
    }
    xml += `
        </Genre>`;
  }

  xml += `
        <ReleaseDate>${formatDate(release.releaseDate)}</ReleaseDate>`;

  if (release.originalReleaseDate) {
    xml += `
        <OriginalReleaseDate>${formatDate(release.originalReleaseDate)}</OriginalReleaseDate>`;
  }

  if (release.cLine) {
    xml += `
        <CLine>
          <Year>${release.cLineYear || new Date().getFullYear()}</Year>
          <CLineText>${escXml(release.cLine)}</CLineText>
        </CLine>`;
  }
  if (release.pLine) {
    xml += `
        <PLine>
          <Year>${release.pLineYear || new Date().getFullYear()}</Year>
          <PLineText>${escXml(release.pLine)}</PLineText>
        </PLine>`;
  }

  xml += `
      </ReleaseDetailsByTerritory>

      <!-- Track listing -->`;

  for (const track of tracks) {
    const ref = track.audioAsset
      ? resourceRefs[track.audioAsset.id] || `A${track.trackNumber}`
      : `A${track.trackNumber}`;
    xml += `
      <ResourceGroup>
        <ResourceGroup>
          <SequenceNumber>${escXml(track.trackNumber)}</SequenceNumber>
          <ResourceGroupContentItem>
            <SequenceNumber>${escXml(track.trackNumber)}</SequenceNumber>
            <ResourceType>SoundRecording</ResourceType>
            <ReleaseResourceReference>${escXml(ref)}</ReleaseResourceReference>
          </ResourceGroupContentItem>
        </ResourceGroup>
      </ResourceGroup>`;
  }

  // VEVO Thumbnail linking: Link cover art Image to release (spec §3.2)
  if (release.coverUrl) {
    xml += `
      <ResourceGroup>
        <ResourceGroupContentItem>
          <ReleaseResourceReference>A0</ReleaseResourceReference>
          <LinkedReleaseResourceReference LinkDescription="VideoScreenCapture">A0</LinkedReleaseResourceReference>
        </ResourceGroupContentItem>
      </ResourceGroup>`;
  }

  xml += `
    </Release>
  </ReleaseList>

  <!-- DEAL LIST -->
  <DealList>
    <ReleaseDeal>
      <DealReleaseReference>R0</DealReleaseReference>
      <Deal>
        <DealTerms>
          <CommercialModelType>SubscriptionModel</CommercialModelType>
          <CommercialModelType>AdvertisementSupportedModel</CommercialModelType>
          <Usage>
            <UseType>OnDemandStream</UseType>
            <UseType>PermanentDownload</UseType>
          </Usage>`;

  for (const territory of territories) {
    xml += `
          <TerritoryCode>${escXml(territory)}</TerritoryCode>`;
  }

  xml += `
          <ValidityPeriod>
            <StartDate>${formatDate(release.releaseDate)}</StartDate>
          </ValidityPeriod>
        </DealTerms>
      </Deal>
    </ReleaseDeal>`;

  // UGC/Clip deals for tracks with snippet data (TikTok, Instagram Reels)
  const clipTracks = tracks.filter(
    (t) => t.snippetStart != null || t.snippetEnd != null,
  );
  if (clipTracks.length > 0) {
    for (const track of clipTracks) {
      xml += `
    <ReleaseDeal>
      <DealReleaseReference>R0</DealReleaseReference>
      <Deal>
        <DealTerms>
          <CommercialModelType>RightsClaimModel</CommercialModelType>
          <Usage>
            <UseType>UserMakeAvailableClip</UseType>
          </Usage>`;
      for (const territory of territories) {
        xml += `
          <TerritoryCode>${escXml(territory)}</TerritoryCode>`;
      }
      xml += `
          <ValidityPeriod>
            <StartDate>${formatDate(release.releaseDate)}</StartDate>
          </ValidityPeriod>
        </DealTerms>
      </Deal>
    </ReleaseDeal>`;
    }
  }

  xml += `
  </DealList>
</ern:NewReleaseMessage>`;

  return xml;
}

/**
 * Generate takedown ERN XML
 */
export function generateTakedownERN(
  release: ERNRelease,
  options: Partial<ERNOptions> = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const messageId = opts.messageId || `TAKEDOWN-${release.id}-${Date.now()}`;
  const now = new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<ern:NewReleaseMessage
  xmlns:ern="http://ddex.net/xml/ern/43"
  MessageSchemaVersionId="ern/43"
  LanguageAndScriptCode="en">
  <MessageHeader>
    <MessageThreadId>${escXml(messageId)}</MessageThreadId>
    <MessageId>${escXml(messageId)}</MessageId>
    <MessageSender>
      <PartyId>${escXml(opts.senderId)}</PartyId>
      <PartyName><FullName>${escXml(opts.senderName)}</FullName></PartyName>
    </MessageSender>
    <MessageRecipient>
      <PartyId>${escXml(opts.recipientId)}</PartyId>
      <PartyName><FullName>${escXml(opts.recipientName)}</FullName></PartyName>
    </MessageRecipient>
    <MessageCreatedDateTime>${now}</MessageCreatedDateTime>
  </MessageHeader>
  <ReleaseList>
    <Release>
      <ReleaseReference>R0</ReleaseReference>
      <ReleaseId>
        ${release.ean ? `<ICPN>${escXml(release.ean)}</ICPN>` : ""}
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">${escXml(release.id)}</ProprietaryId>
      </ReleaseId>
      <ReferenceTitle>
        <TitleText>${escXml(release.title)}</TitleText>
      </ReferenceTitle>
    </Release>
  </ReleaseList>
  <DealList>
    <ReleaseDeal>
      <DealReleaseReference>R0</DealReleaseReference>
      <Deal>
        <DealTerms>
          <CommercialModelType>NoCommercialModel</CommercialModelType>
          <Usage><UseType>Takedown</UseType></Usage>
          <TerritoryCode>Worldwide</TerritoryCode>
          <ValidityPeriod>
            <StartDate>${formatDate(new Date())}</StartDate>
          </ValidityPeriod>
        </DealTerms>
      </Deal>
    </ReleaseDeal>
  </DealList>
</ern:NewReleaseMessage>`;
}

/**
 * Validate ERN XML structure (expanded ERN 4.3 validation)
 */
export function validateERN(xml: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Structure checks
  if (!xml.includes("<ern:NewReleaseMessage"))
    errors.push("Missing root element <ern:NewReleaseMessage>");
  if (!xml.includes("<MessageHeader>")) errors.push("Missing <MessageHeader>");
  if (!xml.includes("<MessageId>")) errors.push("Missing <MessageId>");
  if (!xml.includes("<MessageSender>")) errors.push("Missing <MessageSender>");
  if (!xml.includes("<MessageRecipient>"))
    errors.push("Missing <MessageRecipient>");
  if (!xml.includes("<PartyList>"))
    warnings.push("Missing <PartyList> — required for ERN 4.3 compliance");
  if (!xml.includes("<ResourceList>") && !xml.includes("<DealList>"))
    errors.push("Missing <ResourceList> or <DealList>");
  if (!xml.includes("<ReleaseList>")) errors.push("Missing <ReleaseList>");

  // Resource checks
  if (xml.includes("<SoundRecording>")) {
    if (!xml.includes("<SoundRecordingId>"))
      errors.push("SoundRecording missing <SoundRecordingId>");
    if (!xml.includes("<ResourceReference>"))
      errors.push("SoundRecording missing <ResourceReference>");
  }

  // Deal checks
  if (xml.includes("<DealList>") && !xml.includes("<DealTerms>"))
    errors.push("DealList missing <DealTerms>");

  // ISRC format check
  const isrcMatches = xml.match(/<ISRC>([^<]+)<\/ISRC>/g) || [];
  for (const m of isrcMatches) {
    const val = m.replace(/<\/?ISRC>/g, "");
    if (!/^[A-Z]{2}\w{3}\d{7}$/.test(val.replace(/-/g, ""))) {
      warnings.push(`Invalid ISRC format: ${val} (expected CC-XXX-YY-NNNNN)`);
    }
  }

  // ISWC format check
  const iswcMatches = xml.match(/<ISWC>([^<]+)<\/ISWC>/g) || [];
  for (const m of iswcMatches) {
    const val = m.replace(/<\/?ISWC>/g, "");
    if (!/^T-?\d{3}\.?\d{3}\.?\d{3}-?\d$/.test(val)) {
      warnings.push(`Invalid ISWC format: ${val} (expected T-NNN.NNN.NNN-C)`);
    }
  }

  // EAN/ICPN check
  const icpnMatches = xml.match(/<ICPN>([^<]+)<\/ICPN>/g) || [];
  for (const m of icpnMatches) {
    const val = m.replace(/<\/?ICPN>/g, "");
    if (!/^\d{12,13}$/.test(val)) {
      warnings.push(`Invalid EAN/UPC format: ${val} (expected 12-13 digits)`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Pre-generation data validation — checks business rules before XML generation
 */
export function validateERNData(
  release: ERNRelease,
  tracks: ERNTrack[],
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Release checks
  if (!release.title) errors.push("Release title is required");
  if (!release.releaseDate) errors.push("Release date is required");
  if (!release.coverUrl)
    errors.push("Release cover artwork is required for ERN 4.3 generation");
  if (release.ean && !/^\d{12,13}$/.test(release.ean))
    errors.push(`Invalid EAN/UPC: ${release.ean}`);

  // Track checks
  for (const track of tracks) {
    const prefix = `Track "${track.title}"`;
    if (!track.title) errors.push(`${prefix}: title is required`);
    if (!track.audioAsset)
      errors.push(
        `${prefix}: missing audio asset (WAV/FLAC) required for ERN delivery`,
      );
    if (
      track.isrc &&
      !/^[A-Z]{2}\w{3}\d{7}$/.test(track.isrc.replace(/-/g, ""))
    ) {
      errors.push(`${prefix}: invalid ISRC format "${track.isrc}"`);
    }
    if (track.iswc && !/^T-?\d{3}\.?\d{3}\.?\d{3}-?\d$/.test(track.iswc)) {
      warnings.push(`${prefix}: invalid ISWC format "${track.iswc}"`);
    }

    // Splits validation (Rule 0: total must === 100%)
    let authors: any[] = [];
    if (track.composition?.authors) {
      if (typeof track.composition.authors === "string") {
        try {
          authors = JSON.parse(track.composition.authors);
        } catch (e) {}
      } else if (Array.isArray(track.composition.authors)) {
        authors = track.composition.authors;
      }
    }
    if (!Array.isArray(authors)) authors = [];

    if (authors.length > 0) {
      const totalShare = authors.reduce((sum, s) => {
        const writerShare = Number(s.share) || 0;
        const pubShare = Number(s.publisher?.share) || 0;
        return sum + writerShare + pubShare;
      }, 0);
      if (Math.abs(totalShare - 100) > 0.01) {
        errors.push(
          `${prefix}: splits total is ${totalShare}%, must be exactly 100%`,
        );
      }
      // Rule 2: no zero shares
      for (const s of authors) {
        if (Number(s.share) === 0)
          errors.push(
            `${prefix}: writer "${s.name}" has 0% share (not allowed)`,
          );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Helpers: map internal values to DDEX vocabulary
function mapRole(role: string): string {
  const roleMap: Record<string, string> = {
    composer: "Composer",
    lyricist: "Lyricist",
    arranger: "Arranger",
    producer: "Producer",
    mixer: "Mixer",
    mastering: "MasteringEngineer",
    performer: "Performer",
    vocalist: "Vocalist",
    guitarist: "Guitarist",
    bassist: "Bassist",
    drummer: "Drummer",
    keyboardist: "KeyboardPlayer",
    engineer: "StudioEngineer",
    "immersive audio engineer": "ImmersiveAudioEngineer",
  };
  return roleMap[role.toLowerCase()] || role;
}

function mapCodec(codec: string): string {
  const codecMap: Record<string, string> = {
    FLAC: "FLAC",
    WAV: "PCM",
    MP3: "MP3",
    AAC: "AAC",
    OGG: "OGG",
    ALAC: "ALAC",
  };
  return codecMap[codec.toUpperCase()] || codec;
}

function mapReleaseType(format: string): string {
  const formatMap: Record<string, string> = {
    SINGLE: "Single",
    EP: "EP",
    ALBUM: "Album",
    COMPILATION: "Compilation",
  };
  return formatMap[format] || "Single";
}

export type { ERNRelease, ERNTrack, ERNAsset, ERNOptions };
