// DDEX ERN Standard — Release Export (B2B2B entity-hierarchy scoped)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isAdmin,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { getUploadApiKey } from "@/lib/upload";

// Upload server file root (audio, covers, etc.)
const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  "..",
  "bealpha-upload-server",
  "uploads",
);

// =====================================================
// DDEX ERN Standard - Complete Flat File Column Headers
// Based on DDEX Electronic Release Notification (ERN) v4
// =====================================================

const DDEX_HEADERS: string[] = [
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

function buildEmptyRow(): Record<string, string> {
  const row: Record<string, string> = {};
  for (const header of DDEX_HEADERS) {
    row[header] = "";
  }
  return row;
}

function formatDate(d: any): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().split("T")[0];
  // Handle string dates — try to normalize to YYYY-MM-DD
  const str = String(d);
  if (str.includes("T")) return str.split("T")[0];
  return str;
}

// ── Helper: escape XML special characters ──
function escapeXml(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Helper: format localized array into string ──
function exportLocalized(val: any): string {
  if (!val) return "";
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === "object") return JSON.stringify([val]);
  return String(val);
}

export async function GET(request: NextRequest) {
  try {
    // A8 fix: use getSecureSession — data export must block banned/deactivated users
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "xlsx";
    const templateOnly = searchParams.get("template") === "true";

    // Build role-scoped where clause (B2B2B entity-hierarchy — same as releases GET)
    let releaseWhere: Record<string, unknown> = {};
    if (isSystemAdmin(session)) {
      // System admins see all releases
    } else if (session.tenantId) {
      if (session.entityType === "SUB_ACCOUNT") {
        if (session.roles.includes("artist")) {
          releaseWhere.OR = [
            { ownerId: session.entityId },
            { artist: { name: session.entityName } }
          ];
        } else {
          releaseWhere.ownerId = session.entityId;
        }
      } else {
        // Organization: all releases within entity hierarchy
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        releaseWhere.tenantId = { in: accessibleIds };
      }
      // Staff roles: expand scope to see all tenant releases
      if (session.roles.includes("moderator") || session.roles.includes("supporter")) {
        if (session.entityType === "SUB_ACCOUNT" && session.tenantId) {
          releaseWhere = {
            OR: [
              { ownerId: session.entityId },
              { tenantId: session.tenantId },
            ],
          };
        }
      }
    } else {
      releaseWhere = { id: { in: [] } }; // No tenant = no access
    }

    // Fetch releases with scoping applied
    const releases = templateOnly
      ? []
      : await prisma.release.findMany({
          where: releaseWhere,
          include: {
            artist: true,
            label: true,
            tracks: {
              include: {
                audioAsset: true,
                artist: true,
                composition: true,
              },
              orderBy: { trackNumber: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
        });

    // Build data rows
    const rows: Record<string, string>[] = [];

    for (const release of releases) {
      const r = release as any;
      const tracks = r.tracks || [];
      const trackList = tracks.length > 0 ? tracks : [null];

      for (const track of trackList) {
        const row = buildEmptyRow();
        const t = track || ({} as any);

        // ── RECORDING ──
        row["Recording title"] = t.title || "";
        row["Recording title language"] = "";
        row["Recording title localized"] = exportLocalized(t.titleLocalized);
        row["Recording subtitle"] = t.subtitle || "";
        row["Recording subtitle language"] = "";
        row["Recording subtitle localized"] = exportLocalized(
          t.subtitleLocalized,
        );
        row["Recording alternative title"] = t.alternativeTitle || "";
        row["Recording alternative title language"] = "";
        row["Recording alternative title localized"] = exportLocalized(
          t.alternativeTitleLocalized,
        );
        row["Recording display title"] = t.displayArtist
          ? `${t.title} - ${t.displayArtist}`
          : t.title || "";
        row["Recording ISRC"] = t.isrc || "";
        row["Recording catalogue number"] = t.catalogueNumber || "";
        row["Recording proprietary ID"] = t.id || "";
        row["Recording resource type"] = "SoundRecording";
        row["Recording genre"] = t.genre || "";
        row["Recording sub-genre"] = "";
        row["Recording explicit lyrics"] = t.explicitLyrics
          ? "Explicit"
          : "NotExplicit";
        row["Recording parental warning"] = t.explicitLyrics
          ? "Explicit"
          : "NotExplicit";
        row["Recording duration"] = t.duration ? String(t.duration) : "";
        row["Recording creation date"] = formatDate(t.creationDate);
        row["Recording mastering date"] = "";
        row["Recording country of creation"] = t.countryOfCreation || "";
        row["Recording country of mastering"] = "";
        row["Recording language of performance"] = t.lyricsLanguage || "";
        row["Recording recording location"] = "";
        row["Recording recording studio"] = "";
        row["Recording BPM"] = "";
        row["Recording musical key"] = "";
        row["Recording time signature"] = "";
        row["Recording audio codec"] = t.audioAsset?.codec || "";
        row["Recording bit rate"] = t.audioAsset?.bitRate
          ? String(t.audioAsset.bitRate)
          : "";
        row["Recording bit depth"] = "";
        row["Recording sample rate"] = t.audioAsset?.sampleRate
          ? String(t.audioAsset.sampleRate)
          : "";
        row["Recording number of channels"] = t.audioAsset?.channels
          ? String(t.audioAsset.channels)
          : "";
        row["Recording keywords"] = "";

        // Main artist
        row["Recording main artist"] = t.artist?.name || t.displayArtist || "";
        row["Recording main artist localized"] = exportLocalized(
          t.displayArtistLocalized,
        );
        row["Recording main artist key name"] = "";
        row["Recording main artist ISNI"] = t.artist?.isni || "";
        row["Recording main artist DPID"] = t.artist?.dpid || "";
        row["Recording main artist role"] = "MainArtist";
        row["Recording main artist sequence"] = "1";
        row["Recording main artist share"] = "";

        // Featured artists
        const featured = Array.isArray(t.featuredArtists)
          ? t.featuredArtists
          : [];
        for (let i = 0; i < 2; i++) {
          const fa = featured[i];
          const pfx = `Recording featured artist #${i + 1}`;
          row[pfx] = fa?.name || "";
          row[`${pfx} localized`] = exportLocalized(fa?.nameLocalized);
          row[`${pfx} key name`] = fa?.keyName || "";
          row[`${pfx} ISNI`] = fa?.isni || "";
          row[`${pfx} role`] = fa?.role || (fa ? "FeaturedArtist" : "");
          row[`${pfx} share`] = fa?.share || "";
        }

        // Contributors (exclude Producer/Remixer/Conductor — they have dedicated export fields)
        const contribRaw = t.contributors || [];
        const dedicatedRoles = ["Producer", "Remixer", "Conductor"];
        const allContribs = (
          typeof contribRaw === "object" && !Array.isArray(contribRaw)
            ? [
                ...(contribRaw.performers || []),
                ...(contribRaw.studioPersonnel || []),
                ...(contribRaw.labelPersonnel || []),
              ]
            : Array.isArray(contribRaw)
              ? contribRaw
              : []
        ).filter((c: any) => !dedicatedRoles.includes(c?.role));
        for (let i = 0; i < 4; i++) {
          const c = allContribs[i];
          const pfx = `Recording contributor #${i + 1}`;
          row[pfx] = c?.name || "";
          row[`${pfx} localized`] = exportLocalized(c?.nameLocalized);
          row[`${pfx} role`] = c?.role || "";
          row[`${pfx} ISNI`] = c?.isni || "";
          row[`${pfx} instrument`] = c?.instrument || "";
          row[`${pfx} share`] = c?.share || "";
        }

        // Indirect contributors
        const indirects =
          typeof contribRaw === "object" && !Array.isArray(contribRaw)
            ? contribRaw.indirectContributors || []
            : [];
        for (let i = 0; i < 2; i++) {
          const ic = indirects[i];
          row[`Recording indirect contributor #${i + 1}`] = ic?.name || "";
          row[`Recording indirect contributor #${i + 1} role`] = ic?.role || "";
          row[`Recording indirect contributor #${i + 1} ISNI`] = ic?.isni || "";
        }

        // Producer / Remixer / Conductor
        row["Recording producer"] = t.producer || "";
        row["Recording producer localized"] = exportLocalized(
          t.producerLocalized,
        );
        row["Recording producer ISNI"] = "";
        row["Recording producer share"] = t.producerShare
          ? String(t.producerShare)
          : "";
        row["Recording remixer"] = t.remixer || "";
        row["Recording remixer localized"] = "";
        row["Recording remixer ISNI"] = "";
        row["Recording conductor"] = t.conductor || "";
        row["Recording conductor localized"] = exportLocalized(
          t.conductorLocalized,
        );
        row["Recording conductor ISNI"] = "";
        row["Recording conductor share"] = t.conductorShare
          ? String(t.conductorShare)
          : "";

        // Label
        row["Recording label"] = t.recordingLabel || r.label?.name || "";
        row["Recording label localized"] = exportLocalized(
          t.recordingLabelLocalized,
        );
        row["Recording label P-line"] = r.pLine || "";
        row["Recording label P-line year"] = r.pLineYear
          ? String(r.pLineYear)
          : "";
        row["Recording label DPID"] = r.label?.dpid || "";
        row["Recording label share"] = t.recordingLabelShare
          ? String(t.recordingLabelShare)
          : "";

        // Rights controller
        row["Recording rights controller name"] = "";
        row["Recording rights controller role"] = "";
        row["Recording rights controller share"] = "";

        // Territories
        row["Recording territories"] = t.territories || "Worldwide";
        row["Recording excluding territories"] = t.excludingTerritories || "";
        row["Recording contract period begins"] = formatDate(
          t.contractPeriodBegins,
        );
        row["Recording contract period ends"] = formatDate(
          t.contractPeriodEnds,
        );
        row["Recording contract number"] = t.contractNumber || "";

        // Audio file
        row["Recording audio file name"] =
          t.audioAsset?.fileName || t.audioAsset?.originalFileName || "";
        row["Recording audio file path"] = t.audioAsset?.fileUrl || "";
        row["Recording audio hash sum"] = "";
        row["Recording audio hash sum algorithm"] = "";
        row["Recording snippet start"] = t.snippetStart
          ? String(t.snippetStart)
          : "";
        row["Recording snippet end"] = t.snippetEnd ? String(t.snippetEnd) : "";
        row["Recording preview clip file name"] = "";

        // ── RELEASE ──
        row["Release title"] = r.title || "";
        row["Release title language"] = r.metaLanguage || "";
        row["Release title localized"] = exportLocalized(r.titleLocalized);
        row["Release subtitle"] = r.subtitle || "";
        row["Release subtitle language"] = "";
        row["Release subtitle localized"] = exportLocalized(
          r.subtitleLocalized,
        );
        row["Release display title"] = r.displayArtist
          ? `${r.title} - ${r.displayArtist}`
          : r.title || "";
        row["Release artist"] = r.artist?.name || r.displayArtist || "";
        row["Release artist localized"] = exportLocalized(
          r.displayArtistLocalized,
        );
        row["Release artist key name"] = "";
        row["Release artist ISNI"] = r.artist?.isni || "";
        row["Release artist DPID"] = r.artist?.dpid || "";
        row["Release type"] = r.type || "AUDIO";
        row["Release format"] = r.format || "SINGLE";
        row["Release genre"] = r.genre || "";
        row["Release sub-genre"] = r.subGenre || "";
        row["Release EAN / UPC"] = r.ean || "";
        row["Release GRID"] = r.grid || "";
        row["Release ICPN"] = r.ean || "";
        row["Release catalogue number"] = r.catalogueNumber || "";
        row["Release proprietary ID"] = r.id || "";
        row["Release outlets"] = r.outlets || "";
        row["Release date"] = formatDate(r.releaseDate);
        row["Release original release date"] = formatDate(
          r.originalReleaseDate,
        );
        row["Release pre-order date"] = "";
        row["Release duration"] = "";
        row["Release number of tracks"] = tracks.length
          ? String(tracks.length)
          : "";
        row["Release track number"] = t.trackNumber
          ? String(t.trackNumber)
          : "";
        row["Release disc number"] = t.discNumber ? String(t.discNumber) : "1";
        row["Release volume number"] = "";
        row["Release parental warning"] = t.explicitLyrics
          ? "Explicit"
          : "NotExplicit";
        row["Release meta language"] = r.metaLanguage || "en";
        row["Release territories"] = r.territories || "Worldwide";
        row["Release excluding territories"] = r.excludingTerritories || "";
        row["Release p-line text"] = r.pLine || "";
        row["Release p-line year"] = r.pLineYear ? String(r.pLineYear) : "";
        row["Release c-line text"] = r.cLine || "";
        row["Release c-line year"] = r.cLineYear ? String(r.cLineYear) : "";
        row["Release cover image file name"] =
          r.coverImageFileName || r.coverUrl?.split("/").pop() || "";
        row["Release cover image type"] = "FrontCoverImage";
        row["Release status"] = r.status || "";

        // Deal (placeholder)
        row["Deal commercial model type"] = "";
        row["Deal use type"] = "";
        row["Deal territory"] = "";
        row["Deal start date"] = "";
        row["Deal end date"] = "";
        row["Deal price type"] = "";
        row["Deal wholesale price"] = "";
        row["Deal currency"] = "";
        row["Deal takedown"] = "";

        // ── COMPOSITION (prefer linked Composition model, fallback to track-level) ──
        const comp = t.composition || ({} as any);
        row["Composition title"] = comp.title || t.title || "";
        row["Composition title language"] = "";
        row["Composition title localized"] = exportLocalized(
          comp.titleLocalized || t.titleLocalized,
        );
        row["Composition subtitle"] = comp.subtitle || "";
        row["Composition subtitle language"] = "";
        row["Composition subtitle localized"] = exportLocalized(
          comp.subtitleLocalized,
        );
        row["Composition alternative title"] =
          comp.alternativeTitle || t.alternativeTitle || "";
        row["Composition alternative title language"] = "";
        row["Composition alternative title localized"] = exportLocalized(
          comp.alternativeTitleLocalized || t.alternativeTitleLocalized,
        );
        row["Composition ISWC"] = comp.iswc || "";
        row["Composition catalogue number"] = comp.catalogueNumber || "";
        row["Composition proprietary ID"] = comp.id || "";
        row["Composition genre"] = comp.genre || t.genre || "";
        row["Composition sub-genre"] = "";
        row["Composition creation date"] = formatDate(
          comp.creationDate || t.creationDate,
        );
        row["Composition lyrics languages"] =
          comp.lyricsLanguages || t.lyricsLanguage || "";
        row["Composition lyrics text"] = t.lyrics || "";
        row["Composition lyrics file name"] = comp.lyricsFileName || "";
        row["Composition territories"] =
          comp.territories || t.territories || "Worldwide";
        row["Composition excluding territories"] =
          comp.excludingTerritories || t.excludingTerritories || "";
        row["Composition contract period begins"] = formatDate(
          comp.contractPeriodBegins,
        );
        row["Composition contract period ends"] = formatDate(
          comp.contractPeriodEnds,
        );
        row["Composition contract number"] = comp.contractNumber || "";

        // ── AUTHORS (prefer composition.authors, fallback to contributors with composer roles) ──
        const compAuthors = Array.isArray(comp.authors) ? comp.authors : [];
        const composContribs =
          compAuthors.length > 0
            ? compAuthors
            : Array.isArray(contribRaw)
              ? contribRaw.filter((c: any) =>
                  [
                    "Composer",
                    "Lyricist",
                    "Author",
                    "ComposerLyricist",
                    "Arranger",
                    "Adapter",
                  ].includes(c.role),
                )
              : typeof contribRaw === "object" && contribRaw?.compositional
                ? contribRaw.compositional
                : [];

        for (let i = 0; i < 6; i++) {
          const author = composContribs[i];
          const pfx = `Author #${i + 1}`;
          row[`${pfx} name`] = author?.name || "";
          row[`${pfx} name localized`] = exportLocalized(author?.nameLocalized);
          row[`${pfx} first name`] = author?.firstName || "";
          row[`${pfx} last name`] = author?.lastName || "";
          row[`${pfx} role`] = author?.role || "";
          row[`${pfx} IPI name number`] =
            author?.ipiNameNumber || author?.ipi || "";
          row[`${pfx} IPI base number`] =
            author?.ipiBaseNumber || author?.ipiBase || "";
          row[`${pfx} ISNI`] = author?.isni || "";
          row[`${pfx} society`] = author?.society || "";
          row[`${pfx} society territory`] = author?.societyTerritory || "";
          row[`${pfx} share`] = author?.share || "";
          row[`${pfx} publisher`] = author?.publisher || "";
          row[`${pfx} publisher localized`] = exportLocalized(
            author?.publisherLocalized,
          );
          row[`${pfx} publisher IPI name number`] =
            author?.publisherIpiNameNumber || author?.publisherIpi || "";
          row[`${pfx} publisher IPI base number`] =
            author?.publisherIpiBaseNumber || author?.publisherIpiBase || "";
          row[`${pfx} publisher ISNI`] = author?.publisherIsni || "";
          row[`${pfx} publisher society`] = author?.publisherSociety || "";
          row[`${pfx} publisher share`] = author?.publisherShare || "";
          row[`${pfx} sub-publisher`] = author?.subPublisher || "";
          row[`${pfx} sub-publisher share`] = author?.subPublisherShare || "";
        }

        rows.push(row);
      }
    }

    // ────────────────────── Generate output ──────────────────────
    const firstRelease = releases.length > 0 ? releases[0] : null;
    const partyName =
      firstRelease?.label?.ddexPartyName ||
      process.env.DDEX_PARTY_NAME ||
      "Distributor";
    const partyId =
      firstRelease?.label?.dpid || process.env.DDEX_PARTY_IDENTIFIER || "";
    const filePrefix = partyName.replace(/[^a-zA-Z0-9]/g, "_");

    if (format === "csv") {
      const ws = XLSX.utils.json_to_sheet(
        rows.length > 0 ? rows : [buildEmptyRow()],
        {
          header: DDEX_HEADERS,
        },
      );
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";", RS: "\n" });

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filePrefix}_DDEX_${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    } else if (format === "xml" || format === "zip") {
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml +=
        '<ern:NewReleaseMessage xmlns:ern="http://ddex.net/xml/ern/43" LanguageAndScriptCode="en">\n';
      xml += "  <MessageHeader>\n";
      xml += `    <MessageId>${partyName.replace(/\s+/g, "")}_${new Date().toISOString()}</MessageId>\n`;
      xml += `    <MessageCreatedDateTime>${new Date().toISOString()}</MessageCreatedDateTime>\n`;
      xml += "    <MessageSender>\n";
      if (partyId) {
        xml += `      <PartyId>${escapeXml(partyId)}</PartyId>\n`;
      }
      xml += `      <PartyName><FullName>${escapeXml(partyName)}</FullName></PartyName>\n`;
      xml += "    </MessageSender>\n";
      xml += "  </MessageHeader>\n";
      xml += "  <ResourceList>\n";

      for (const row of rows) {
        xml += "    <SoundRecording>\n";
        for (const key of DDEX_HEADERS.filter((h) =>
          h.startsWith("Recording"),
        )) {
          const value = row[key];
          if (value) {
            const tagName = key
              .replace(/^Recording\s+/, "")
              .replace(/\s+/g, "")
              .replace(/[^\w]/g, "");
            xml += `      <${tagName}>${escapeXml(String(value))}</${tagName}>\n`;
          }
        }
        xml += "    </SoundRecording>\n";
      }

      xml += "  </ResourceList>\n";
      xml += "  <ReleaseList>\n";

      const releaseMap = new Map<string, any[]>();
      for (const row of rows) {
        const title = row["Release title"];
        if (!releaseMap.has(title)) releaseMap.set(title, []);
        releaseMap.get(title)!.push(row);
      }

      for (const [, releaseRows] of releaseMap) {
        const firstRow = releaseRows[0];
        xml += "    <Release>\n";
        for (const key of DDEX_HEADERS.filter(
          (h) =>
            h.startsWith("Release") &&
            !h.includes("track number") &&
            !h.includes("disc number"),
        )) {
          const value = firstRow[key];
          if (value) {
            const tagName = key
              .replace(/^Release\s+/, "")
              .replace(/\s+/g, "")
              .replace(/[^\w]/g, "");
            xml += `      <${tagName}>${escapeXml(String(value))}</${tagName}>\n`;
          }
        }
        xml += "    </Release>\n";
      }

      xml += "  </ReleaseList>\n";

      // ── Composition List ──
      xml += "  <WorkList>\n";
      const compositionHeaders = DDEX_HEADERS.filter((h) =>
        h.startsWith("Composition"),
      );
      for (const row of rows) {
        const hasCompData = compositionHeaders.some((h) => row[h]);
        if (!hasCompData) continue;
        xml += "    <MusicalWork>\n";
        for (const key of compositionHeaders) {
          const value = row[key];
          if (value) {
            const tagName = key
              .replace(/^Composition\s+/, "")
              .replace(/\s+/g, "")
              .replace(/[^\w]/g, "");
            xml += `      <${tagName}>${escapeXml(String(value))}</${tagName}>\n`;
          }
        }

        // Authors within the composition
        const authorHeaders = DDEX_HEADERS.filter((h) =>
          h.startsWith("Author"),
        );
        const hasAuthorData = authorHeaders.some((h) => row[h]);
        if (hasAuthorData) {
          xml += "      <Authors>\n";
          for (let i = 1; i <= 6; i++) {
            const name = row[`Author #${i} name`];
            if (!name) continue;
            xml += `        <Author>\n`;
            for (const key of authorHeaders.filter((h) =>
              h.startsWith(`Author #${i}`),
            )) {
              const value = row[key];
              if (value) {
                const tagName = key
                  .replace(/^Author #\d+\s+/, "")
                  .replace(/\s+/g, "")
                  .replace(/[^\w]/g, "");
                xml += `          <${tagName}>${escapeXml(String(value))}</${tagName}>\n`;
              }
            }
            xml += `        </Author>\n`;
          }
          xml += "      </Authors>\n";
        }

        xml += "    </MusicalWork>\n";
      }
      xml += "  </WorkList>\n";

      xml += "</ern:NewReleaseMessage>";

      if (format === "xml") {
        return new NextResponse(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filePrefix}_DDEX_${new Date().toISOString().split("T")[0]}.xml"`,
          },
        });
      } else {
        // ZIP format
        const releaseId = firstRelease?.id;
        if (!releaseId) {
          return NextResponse.json(
            { error: "ERROR_NO_RELEASE_FOUND_TO_ZIP" },
            { status: 400 },
          );
        }

        const UPLOAD_SERVER =
          process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
        const zipRes = await fetch(`${UPLOAD_SERVER}/upload/export/ddex`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": getUploadApiKey(),
          },
          body: JSON.stringify({ releaseId, xml }),
        });

        if (!zipRes.ok) {
          const errorData = await zipRes.json().catch(() => ({}));
          return NextResponse.json(
            {
              error:
                errorData.error || "Failed to generate ZIP on upload server",
            },
            { status: zipRes.status },
          );
        }

        return new NextResponse(zipRes.body, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${partyName.replace(/\s+/g, "_")}beAlpha_DDEX_${new Date().toISOString().split("T")[0]}.zip"`,
          },
        });
      }
    } else if (format === "zip_old") {
      // ══════════════════════════════════════════════════
      // ZIP EXPORT — DDEX xlsx + artwork + audio files
      // Structure:
      //   ${filePrefix}_DDEX.xlsx
      //   artwork/  (cover images)
      //   audio/    (track audio files)
      // ══════════════════════════════════════════════════
      const zip = new JSZip();

      // 1) Build the XLSX workbook in memory
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [], {
        header: DDEX_HEADERS,
      });
      if (rows.length === 0) {
        for (let i = 0; i < DDEX_HEADERS.length; i++) {
          const cellRef = XLSX.utils.encode_cell({ c: i, r: 0 });
          ws[cellRef] = { v: DDEX_HEADERS[i], t: "s" };
        }
        ws["!ref"] = XLSX.utils.encode_range({
          s: { c: 0, r: 0 },
          e: { c: DDEX_HEADERS.length - 1, r: 0 },
        });
      }
      ws["!cols"] = DDEX_HEADERS.map((h) => ({
        wch: Math.max(15, Math.min(35, h.length + 4)),
      }));
      XLSX.utils.book_append_sheet(wb, ws, "DDEX Releases");

      // Instructions sheet
      const instrData = [
        [`${partyName} — DDEX ERN Flat File Template`],
        [""],
        ["This ZIP package contains:"],
        [
          `• ${filePrefix}_DDEX.xlsx — The DDEX spreadsheet with all release/track metadata`,
        ],
        ["• artwork/ — Cover art images referenced in the spreadsheet"],
        ["• audio/ — Audio files for each track"],
        [""],
        ["To re-import: Upload this entire ZIP file via Import from DDEX."],
        [""],
        [`Generated: ${new Date().toISOString()}`],
        ["Standard: DDEX ERN v4.3"],
        [`Platform: ${partyName} Distribution`],
      ];
      const instrWs = XLSX.utils.aoa_to_sheet(instrData);
      instrWs["!cols"] = [{ wch: 80 }];
      XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

      const xlsxBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      zip.file(`${filePrefix}_DDEX.xlsx`, xlsxBuf);

      // 2) Collect unique artwork & audio files
      const addedFiles = new Set<string>();
      const artworkFolder = zip.folder("artwork")!;
      const audioFolder = zip.folder("audio")!;

      for (const release of releases) {
        const r = release as any;

        // Cover image (sanitize filename to prevent path traversal)
        const rawCoverFile =
          r.coverImageFileName || r.coverUrl?.split("/").pop() || "";
        const coverFile = rawCoverFile ? path.basename(rawCoverFile) : "";
        if (coverFile && !addedFiles.has(`artwork/${coverFile}`)) {
          addedFiles.add(`artwork/${coverFile}`);

          let relativeFromUrl = "";
          try {
            if (r.coverUrl) {
              const urlObj = new URL(r.coverUrl);
              relativeFromUrl = decodeURIComponent(
                urlObj.pathname.replace(/^\/?uploads\//, ""),
              );
            }
          } catch {}

          const coverPaths = [
            path.join(UPLOAD_ROOT, "covers", coverFile),
            relativeFromUrl ? path.join(UPLOAD_ROOT, relativeFromUrl) : "",
            r.coverUrl
              ? path.join(
                  UPLOAD_ROOT,
                  "..",
                  r.coverUrl.replace(/^\/uploads\//, "uploads/"),
                )
              : "",
          ].filter(Boolean);

          for (const p of coverPaths) {
            try {
              // Prevent path traversal — ensure resolved path stays within UPLOAD_ROOT
              const resolvedPath = path.resolve(p);
              if (!resolvedPath.startsWith(path.resolve(UPLOAD_ROOT))) continue;
              await fs.promises.access(p);
              artworkFolder.file(coverFile, await fs.promises.readFile(p));
              break;
            } catch {
              /* skip */
            }
          }
        }

        // Audio files from tracks
        for (const track of r.tracks || []) {
          const audioAsset = track.audioAsset;
          if (!audioAsset) continue;

          const rawAudioFile =
            audioAsset.originalFileName || audioAsset.fileName;
          const audioFile = rawAudioFile ? path.basename(rawAudioFile) : "";
          if (!audioFile || addedFiles.has(`audio/${audioFile}`)) continue;
          addedFiles.add(`audio/${audioFile}`);

          const audioPaths = [
            path.join(UPLOAD_ROOT, "audio", audioAsset.fileName),
            path.join(UPLOAD_ROOT, audioAsset.fileName),
            audioAsset.fileUrl
              ? path.join(
                  UPLOAD_ROOT,
                  "..",
                  audioAsset.fileUrl.replace(/^\/uploads\//, "uploads/"),
                )
              : "",
          ].filter(Boolean);

          for (const p of audioPaths) {
            try {
              // Prevent path traversal — ensure resolved path stays within UPLOAD_ROOT
              const resolvedPath = path.resolve(p);
              if (!resolvedPath.startsWith(path.resolve(UPLOAD_ROOT))) continue;
              await fs.promises.access(p);
              audioFolder.file(audioFile, await fs.promises.readFile(p));
              break;
            } catch {
              /* skip */
            }
          }
        }
      }

      // 3) Generate ZIP buffer
      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const dateStr = new Date().toISOString().split("T")[0];
      return new NextResponse(zipBuffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filePrefix}_DDEX_${dateStr}.zip"`,
        },
      });
    } else {
      // ── Excel (default) — headers always present even with no data ──
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [], {
        header: DDEX_HEADERS,
      });

      // Ensure all header cells exist when no data
      if (rows.length === 0) {
        for (let i = 0; i < DDEX_HEADERS.length; i++) {
          const cellRef = XLSX.utils.encode_cell({ c: i, r: 0 });
          ws[cellRef] = { v: DDEX_HEADERS[i], t: "s" };
        }
        ws["!ref"] = XLSX.utils.encode_range({
          s: { c: 0, r: 0 },
          e: { c: DDEX_HEADERS.length - 1, r: 0 },
        });
      }

      // Column widths
      ws["!cols"] = DDEX_HEADERS.map((h) => ({
        wch: Math.max(15, Math.min(35, h.length + 4)),
      }));

      XLSX.utils.book_append_sheet(wb, ws, "DDEX Releases");

      // Instructions sheet
      const instrData = [
        [`${partyName} — DDEX ERN Flat File Template`],
        [""],
        [
          "This template follows the DDEX Electronic Release Notification (ERN) v4 standard.",
        ],
        ["Each row represents one Recording (Track) within a Release."],
        [""],
        ["SECTIONS:"],
        [
          "• Recording (cols A-DI) — Sound recording metadata, artists, contributors, audio file",
        ],
        [
          "• Release (cols DJ-EC) — Product-level metadata, release dates, cover art",
        ],
        [
          "• Deal (cols ED-EL) — Commercial model, use type, pricing (optional)",
        ],
        ["• Composition (cols EM-FI) — Musical work metadata, lyrics"],
        [
          "• Author #1-#6 (cols FJ-IW) — Songwriters/composers with IPI/ISNI and publishing",
        ],
        [""],
        ["FIELD GUIDELINES:"],
        [
          "• ISRC — International Standard Recording Code, format: XX-XXX-XX-XXXXX",
        ],
        ["• EAN/UPC — 13-digit barcode number for the release"],
        [
          "• ISWC — International Standard Musical Work Code, format: T-XXX.XXX.XXX-X",
        ],
        ["• IPI — Interested Party Information number (9 or 11 digits)"],
        ["• ISNI — International Standard Name Identifier (16 digits)"],
        ["• DPID — DDEX Party Identifier"],
        [
          "• Territories — Use ISO 3166-1 alpha-2 codes (US, GB, JP) or 'Worldwide'",
        ],
        ["• Duration — In seconds (e.g., 234)"],
        ["• Dates — Use ISO 8601 format: YYYY-MM-DD"],
        ["• Explicit — Use 'Explicit', 'NotExplicit', or 'Cleaned'"],
        ["• Multiple values — Separate with semicolons (;)"],
        ["• Resource Type — SoundRecording, Video, Image, Text"],
        ["• Release Format — SINGLE, EP, ALBUM, COMPILATION"],
        [""],
        ["IMPORT NOTES:"],
        [
          "• Fill 'Release title' on every row — tracks are grouped by release title",
        ],
        ["• 'Release track number' determines track ordering within a release"],
        ["• Audio files must be uploaded first via the Assets section"],
        ["• Cover images must be uploaded first via the Releases section"],
        [""],
        [`Generated: ${new Date().toISOString()}`],
        ["Standard: DDEX ERN v4.3"],
        [`Platform: ${partyName} Distribution`],
      ];
      const instrWs = XLSX.utils.aoa_to_sheet(instrData);
      instrWs["!cols"] = [{ wch: 80 }];
      XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

      const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      return new NextResponse(excelBuffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filePrefix}_DDEX_${new Date().toISOString().split("T")[0]}.xlsx"`,
        },
      });
    }
  } catch (error) {
    console.error("Error exporting releases:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_EXPORT_RELEASES" },
      { status: 500 },
    );
  }
}
