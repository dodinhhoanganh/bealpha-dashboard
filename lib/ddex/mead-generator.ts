/**
 * DDEX MEAD (Musical Works) Generator
 *
 * Generates MEAD XML for musical work (composition) notifications.
 * Used for publishing/rights data communication.
 */

interface MEADComposition {
  id: string;
  title: string;
  titleLocalized?: string | null;
  subtitle?: string | null;
  iswc?: string | null;
  catalogueNumber?: string | null;
  genre?: string | null;
  creationDate?: Date | string | null;
  lyricsLanguages?: string | null;
  territories?: string | null;
  excludingTerritories?: string | null;
  authors?: MEADAuthor[] | null;
}

interface MEADAuthor {
  name: string;
  nameLocalized?: string;
  role: string; // Composer, Lyricist, ComposerLyricist, Arranger, Adapter
  ipiNameNumber?: string; // IPI (Interested Party Information) number
  society?: string; // Collection society (ASCAP, BMI, SESAC, etc.)
  share?: number; // Percentage share (0-100)
  publisher?: {
    name: string;
    ipiNameNumber?: string;
    share?: number;
  };
}

function escXml(str: string | null | undefined): string {
  if (!str) return "";
  return str
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

interface MEADOptions {
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  messageId?: string;
}

const DEFAULT_OPTIONS: MEADOptions = {
  senderId: "PADPIDA2024010101A",
  senderName: "BeAlpha Music",
  recipientId: "",
  recipientName: "",
};

/**
 * Generate MEAD XML for one or more compositions
 */
export function generateMEAD(
  compositions: MEADComposition[],
  options: Partial<MEADOptions> = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const messageId = opts.messageId || `MEAD-${Date.now()}`;
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<mead:MusicalWorkNotificationMessage
  xmlns:mead="http://ddex.net/xml/mead/10"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  MessageSchemaVersionId="mead/10">

  <MessageHeader>
    <MessageId>${escXml(messageId)}</MessageId>
    <MessageSender>
      <PartyId>${escXml(opts.senderId)}</PartyId>
      <PartyName>
        <FullName>${escXml(opts.senderName)}</FullName>
      </PartyName>
    </MessageSender>
    <MessageRecipient>
      <PartyId>${escXml(opts.recipientId)}</PartyId>
      <PartyName>
        <FullName>${escXml(opts.recipientName)}</FullName>
      </PartyName>
    </MessageRecipient>
    <MessageCreatedDateTime>${now}</MessageCreatedDateTime>
  </MessageHeader>

  <MusicalWorkList>`;

  for (const comp of compositions) {
    const territories = comp.territories?.split(",").map((t) => t.trim()) || [
      "Worldwide",
    ];
    const authors =
      comp.authors && Array.isArray(comp.authors) ? comp.authors : [];

    xml += `
    <MusicalWork>
      <MusicalWorkId>`;

    if (comp.iswc) {
      xml += `
        <ISWC>${escXml(comp.iswc)}</ISWC>`;
    }
    xml += `
        <ProprietaryId Namespace="DPID:${escXml(opts.senderId)}">${escXml(comp.id)}</ProprietaryId>
      </MusicalWorkId>

      <MusicalWorkTitle>
        <TitleText>${escXml(comp.title)}</TitleText>`;
    if (comp.titleLocalized) {
      xml += `
        <TitleText>${escXml(comp.titleLocalized)}</TitleText>`;
    }
    if (comp.subtitle) {
      xml += `
        <SubTitle>${escXml(comp.subtitle)}</SubTitle>`;
    }
    xml += `
      </MusicalWorkTitle>`;

    if (comp.genre) {
      xml += `
      <Genre>
        <GenreText>${escXml(comp.genre)}</GenreText>
      </Genre>`;
    }

    if (comp.creationDate) {
      xml += `
      <CreationDate>${formatDate(comp.creationDate)}</CreationDate>`;
    }

    if (comp.lyricsLanguages) {
      for (const lang of comp.lyricsLanguages.split(",")) {
        xml += `
      <LyricsLanguage>${escXml(lang.trim())}</LyricsLanguage>`;
      }
    }

    // Authors / Contributors
    for (const author of authors) {
      xml += `
      <MusicalWorkContributor>
        <PartyName>
          <FullName>${escXml(author.name)}</FullName>`;
      if (author.nameLocalized) {
        xml += `
          <FullName>${escXml(author.nameLocalized)}</FullName>`;
      }
      xml += `
        </PartyName>`;

      if (author.ipiNameNumber) {
        xml += `
        <PartyId>
          <IPI>${escXml(author.ipiNameNumber)}</IPI>
        </PartyId>`;
      }

      xml += `
        <MusicalWorkContributorRole>${escXml(mapAuthorRole(author.role))}</MusicalWorkContributorRole>`;

      if (author.share !== undefined) {
        xml += `
        <RightShare>
          <RightSharePercentage>${author.share.toFixed(2)}</RightSharePercentage>`;

        for (const territory of territories) {
          xml += `
          <Territory>${escXml(territory)}</Territory>`;
        }

        if (author.society) {
          xml += `
          <RightsController>
            <PartyName>
              <FullName>${escXml(author.society)}</FullName>
            </PartyName>
            <RightsControllerRole>MusicPublisher</RightsControllerRole>
          </RightsController>`;
        }

        if (author.publisher) {
          xml += `
          <RightsController>
            <PartyName>
              <FullName>${escXml(author.publisher.name)}</FullName>
            </PartyName>`;
          if (author.publisher.ipiNameNumber) {
            xml += `
            <PartyId>
              <IPI>${escXml(author.publisher.ipiNameNumber)}</IPI>
            </PartyId>`;
          }
          xml += `
            <RightsControllerRole>MusicPublisher</RightsControllerRole>`;
          if (author.publisher.share !== undefined) {
            xml += `
            <RightSharePercentage>${author.publisher.share.toFixed(2)}</RightSharePercentage>`;
          }
          xml += `
          </RightsController>`;
        }

        xml += `
        </RightShare>`;
      }

      xml += `
      </MusicalWorkContributor>`;
    }

    // Territory restrictions
    for (const territory of territories) {
      xml += `
      <TerritoryOfLicensing>${escXml(territory)}</TerritoryOfLicensing>`;
    }

    if (comp.excludingTerritories) {
      for (const excl of comp.excludingTerritories.split(",")) {
        xml += `
      <ExcludedTerritory>${escXml(excl.trim())}</ExcludedTerritory>`;
      }
    }

    xml += `
    </MusicalWork>`;
  }

  xml += `
  </MusicalWorkList>
</mead:MusicalWorkNotificationMessage>`;

  return xml;
}

/**
 * Parse MEAD XML to extract composition data (basic parser)
 */
export function parseMEAD(xml: string): Partial<MEADComposition>[] {
  const compositions: Partial<MEADComposition>[] = [];

  // Simple regex-based parsing for MusicalWork elements
  const workRegex = /<MusicalWork>([\s\S]*?)<\/MusicalWork>/g;
  let match;

  while ((match = workRegex.exec(xml)) !== null) {
    const workXml = match[1];

    const title = extractTag(workXml, "TitleText");
    const iswc = extractTag(workXml, "ISWC");
    const genre = extractTag(workXml, "GenreText");

    const authors: MEADAuthor[] = [];
    const contribRegex =
      /<MusicalWorkContributor>([\s\S]*?)<\/MusicalWorkContributor>/g;
    let contribMatch;

    while ((contribMatch = contribRegex.exec(workXml)) !== null) {
      const contribXml = contribMatch[1];
      const name = extractTag(contribXml, "FullName");
      const role = extractTag(contribXml, "MusicalWorkContributorRole");
      const ipi = extractTag(contribXml, "IPI");
      const shareStr = extractTag(contribXml, "RightSharePercentage");

      if (name) {
        authors.push({
          name,
          role: role || "Composer",
          ipiNameNumber: ipi || undefined,
          share: shareStr ? parseFloat(shareStr) : undefined,
        });
      }
    }

    compositions.push({
      title: title || "Untitled",
      iswc: iswc || undefined,
      genre: genre || undefined,
      authors: authors.length > 0 ? authors : undefined,
    });
  }

  return compositions;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function mapAuthorRole(role: string): string {
  const roleMap: Record<string, string> = {
    composer: "Composer",
    lyricist: "Lyricist",
    "composer/lyricist": "ComposerLyricist",
    composerlyricist: "ComposerLyricist",
    arranger: "Arranger",
    adapter: "Adapter",
    translator: "SubArrangerTranslator",
    author: "Author",
  };
  return roleMap[role.toLowerCase()] || role;
}

export type { MEADComposition, MEADAuthor, MEADOptions };
