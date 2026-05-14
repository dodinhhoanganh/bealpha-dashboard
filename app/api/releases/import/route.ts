// DDEX ERN Standard — Batch Import (B2B2B entity-hierarchy scoped)
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSecureSession, hasPermission, PERMISSIONS, isAdmin, isSystemAdmin } from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import fs from "fs";
import path from "path";

// Upload server file root
const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  "..",
  "bealpha-upload-server",
  "uploads",
);

// =====================================================
// DDEX ERN Standard — Batch Import
// Supports: Releases (Albums/Singles/EPs) + Tracks + Assets + Compositions
// Groups rows by "Release title" → creates Release + child Tracks
// Each track can auto-create: Asset record, Composition record, Artists, Labels
// Uses Prisma transactions for atomicity per release batch
// =====================================================

// ── Helper: read column value with multiple header-name fallbacks ──
function col(row: any, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "")
      return String(row[k]).trim();
  }
  return "";
}

// ── Helper: parse semicolon-separated list (only ; to avoid splitting names with commas) ──
function splitList(val: string): string[] {
  return val
    .split(/;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Helper: parse date safely ──
function parseDate(val: string): Date | null {
  if (!val) return null;
  // Handle Excel serial numbers (valid range: ~1 to ~2958465)
  const num = Number(val);
  if (!isNaN(num) && num > 10000 && num < 2958466) {
    // Excel serial date → JS Date
    return new Date((num - 25569) * 86400 * 1000);
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ── Helper: parse int safely ──
function safeInt(val: string): number | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ── Helper: parse decimal safely ──
function safeDecimal(val: string): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n.toString();
}

// ── Helper: normalize release format ──
function normalizeFormat(val: string): string {
  const v = val.toUpperCase().trim();
  const map: Record<string, string> = {
    SINGLE: "SINGLE",
    EP: "EP",
    ALBUM: "ALBUM",
    COMPILATION: "COMPILATION",
    "MINI ALBUM": "EP",
    MIXTAPE: "COMPILATION",
    LP: "ALBUM",
    DELUXE: "ALBUM",
    "DELUXE EDITION": "ALBUM",
    SOUNDTRACK: "COMPILATION",
    "BOX SET": "COMPILATION",
    DEMO: "SINGLE",
    REMIX: "SINGLE",
    "MAXI SINGLE": "SINGLE",
    "DOUBLE ALBUM": "ALBUM",
  };
  return map[v] || "SINGLE";
}

// ── Helper: parse explicit flag ──
function parseExplicit(val: string): boolean {
  const v = val.toLowerCase().trim();
  return ["explicit", "yes", "true", "1"].includes(v);
}

// ── Helper: find asset by filename (B2B2B scoped via release.tenantId) ──
async function findAssetByFilename(
  tx: any,
  filename: string,
  userIsAdmin: boolean,
  accessibleEntityIds: string[]
): Promise<any | null> {
  if (!filename) return null;
  return tx.asset.findFirst({
    where: {
      AND: [
        {
          OR: [
            { fileName: { equals: filename, mode: "insensitive" } },
            { originalFileName: { equals: filename, mode: "insensitive" } },
          ],
        },
        userIsAdmin
          ? {}
          : {
              release: { tenantId: { in: accessibleEntityIds } },
            },
      ],
    },
  });
}

// ── Helper: build featured artists JSON ──
function parseFeaturedArtists(row: any): any[] {
  const artists: any[] = [];
  for (let i = 1; i <= 2; i++) {
    const name = col(row, `Recording featured artist #${i}`);
    if (name) {
      artists.push({
        name,
        nameLocalized:
          col(row, `Recording featured artist #${i} localized`) || null,
        keyName: col(row, `Recording featured artist #${i} key name`) || null,
        isni: col(row, `Recording featured artist #${i} ISNI`) || null,
        role:
          col(row, `Recording featured artist #${i} role`) || "FeaturedArtist",
        share: col(row, `Recording featured artist #${i} share`) || null,
      });
    }
  }
  return artists;
}

// ── Helper: build contributors JSON ──
// NOTE: Producer, Remixer, Conductor are stored as top-level track fields,
// so they are NOT included here to prevent duplication on export→import round-trips.
function parseContributors(row: any): any {
  const contributors: any = {
    performers: [],
    studioPersonnel: [],
    indirectContributors: [],
  };

  // Recording contributors #1-4
  for (let i = 1; i <= 4; i++) {
    const name = col(row, `Recording contributor #${i}`);
    if (name) {
      const role = col(row, `Recording contributor #${i} role`) || "Performer";
      // Skip if role is Producer/Remixer/Conductor (stored as top-level fields)
      if (["Producer", "Remixer", "Conductor"].includes(role)) continue;
      contributors.performers.push({
        name,
        nameLocalized:
          col(row, `Recording contributor #${i} localized`) || null,
        role,
        isni: col(row, `Recording contributor #${i} ISNI`) || null,
        instrument: col(row, `Recording contributor #${i} instrument`) || null,
        share: col(row, `Recording contributor #${i} share`) || null,
      });
    }
  }

  // Indirect contributors #1-2
  for (let i = 1; i <= 2; i++) {
    const name = col(row, `Recording indirect contributor #${i}`);
    if (name) {
      contributors.indirectContributors.push({
        name,
        role: col(row, `Recording indirect contributor #${i} role`) || null,
        isni: col(row, `Recording indirect contributor #${i} ISNI`) || null,
      });
    }
  }

  return contributors;
}

// ── Helper: parse localized string into array ──
function parseLocalized(
  val: any,
): Array<{ language: string; value: string }> | null {
  if (!val || typeof val !== "string" || !val.trim()) return null;
  const str = val.trim();
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // Not JSON, assume it's a simple string, default to 'en'
  }
  return [{ language: "en", value: str }];
}

// ── Helper: parse authors #1-6 for composition ──
function parseAuthors(row: any): any[] {
  const authors: any[] = [];
  for (let i = 1; i <= 6; i++) {
    const name = col(row, `Author #${i} name`);
    if (!name) continue;
    authors.push({
      name,
      nameLocalized: parseLocalized(col(row, `Author #${i} name localized`)),
      firstName: col(row, `Author #${i} first name`) || null,
      lastName: col(row, `Author #${i} last name`) || null,
      role: col(row, `Author #${i} role`) || "Composer",
      ipiNameNumber: col(row, `Author #${i} IPI name number`) || null,
      ipiBaseNumber: col(row, `Author #${i} IPI base number`) || null,
      isni: col(row, `Author #${i} ISNI`) || null,
      society: col(row, `Author #${i} society`) || null,
      societyTerritory: col(row, `Author #${i} society territory`) || null,
      share: col(row, `Author #${i} share`) || null,
      publisher: col(row, `Author #${i} publisher`) || null,
      publisherLocalized: parseLocalized(
        col(row, `Author #${i} publisher localized`),
      ),
      publisherIpiNameNumber:
        col(row, `Author #${i} publisher IPI name number`) || null,
      publisherIpiBaseNumber:
        col(row, `Author #${i} publisher IPI base number`) || null,
      publisherIsni: col(row, `Author #${i} publisher ISNI`) || null,
      publisherSociety: col(row, `Author #${i} publisher society`) || null,
      publisherShare: col(row, `Author #${i} publisher share`) || null,
      subPublisher: col(row, `Author #${i} sub-publisher`) || null,
      subPublisherShare: col(row, `Author #${i} sub-publisher share`) || null,
    });
  }
  return authors;
}

// =====================================================
// POST /api/releases/import
// =====================================================
export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const dryRun = formData.get("dryRun") === "true";
    const format = (formData.get("format") as string) || "xlsx";

    if (!file) {
      return NextResponse.json({ error: "ERROR_NO_FILE_UPLOADED" }, { status: 400 });
    }

    // ── Validate DDEX compliance ──
    const validateOnly = formData.get("validateOnly") === "true";

    // ── Parse file — detect ZIP vs direct spreadsheet ──
    const buffer = await file.arrayBuffer();
    let workbook: XLSX.WorkBook;
    const zipExtractedFiles: {
      audio: Map<string, string>;
      artwork: Map<string, string>;
    } = {
      audio: new Map(),
      artwork: new Map(),
    };

    if (format === "zip") {
      // ══════════════════════════════════════════════════════
      // ZIP IMPORT — extract xlsx + audio + artwork files
      // Expected structure:
      //   *.xlsx or *.csv        (DDEX spreadsheet)
      //   artwork/ or covers/    (cover images)
      //   audio/                 (audio files)
      // ══════════════════════════════════════════════════════
      const zip = await JSZip.loadAsync(buffer);
      let xlsxEntry: JSZip.JSZipObject | null = null;
      let csvEntry: JSZip.JSZipObject | null = null;

      // Ensure upload directories exist (only needed for actual extraction)
      const audioDest = path.join(UPLOAD_ROOT, "audio");
      const coversDest = path.join(UPLOAD_ROOT, "covers");
      if (!validateOnly) {
        for (const dir of [audioDest, coversDest]) {
          await fs.promises.mkdir(dir, { recursive: true });
        }
      }

      // Iterate ZIP entries
      const extractPromises: (() => Promise<void>)[] = [];

      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;

        const fileName = path.basename(relativePath);
        const lowerName = fileName.toLowerCase();
        const lowerPath = relativePath.toLowerCase();

        // Find the spreadsheet
        if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
          xlsxEntry = entry;
        } else if (!xlsxEntry && lowerName.endsWith(".csv")) {
          csvEntry = entry;
        }

        // Detect audio files (by extension only — folder is not required)
        const audioExts = [
          ".wav",
          ".flac",
          ".mp3",
          ".aac",
          ".ogg",
          ".aiff",
          ".m4a",
          ".wma",
          ".alac",
        ];
        const isAudio = audioExts.some((ext) => lowerName.endsWith(ext));

        // Detect artwork files (image extension + optionally in artwork folder, or root-level image)
        const artExts = [".jpg", ".jpeg", ".png", ".webp", ".tiff", ".bmp"];
        const hasArtExt = artExts.some((ext) => lowerName.endsWith(ext));
        const inArtFolder =
          lowerPath.includes("artwork/") ||
          lowerPath.includes("covers/") ||
          lowerPath.includes("cover/") ||
          lowerPath.includes("images/");
        // Artwork = image in art folder, OR image not in audio/ folder (e.g. root-level or other subfolders)
        const isArtwork =
          hasArtExt && (inArtFolder || !lowerPath.includes("audio/"));

        if (isAudio && !validateOnly) {
          extractPromises.push(() =>
            entry.async("nodebuffer").then(async (buf) => {
              const destPath = path.join(audioDest, fileName);
              await fs.promises.writeFile(destPath, buf);
              zipExtractedFiles.audio.set(fileName, destPath);
            }),
          );
        } else if (isAudio && validateOnly) {
          // Just track the file name without extracting
          zipExtractedFiles.audio.set(fileName, "");
        } else if (isArtwork && !validateOnly) {
          extractPromises.push(() =>
            entry.async("nodebuffer").then(async (buf) => {
              const destPath = path.join(coversDest, fileName);
              await fs.promises.writeFile(destPath, buf);
              zipExtractedFiles.artwork.set(fileName, destPath);
            }),
          );
        } else if (isArtwork && validateOnly) {
          // Just track the file name without extracting
          zipExtractedFiles.artwork.set(fileName, "");
        }
      });

      // Extract files in batches to prevent Node.js Out-Of-Memory (OOM) crashes
      // and EMFILE (too many open files) errors for large album ZIPs.
      const BATCH_SIZE = 5;
      for (let i = 0; i < extractPromises.length; i += BATCH_SIZE) {
        const batch = extractPromises.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((fn) => fn()));
      }

      // Parse the spreadsheet from ZIP
      const spreadsheetEntry = xlsxEntry || csvEntry;
      if (!spreadsheetEntry) {
        return NextResponse.json(
          {
            error: "ERROR_NO_SPREADSHEET_XLSX_CSV_FOUND_INSIDE_THE_ZIP",
          },
          { status: 400 },
        );
      }

      const spreadsheetBuf = await (
        spreadsheetEntry as JSZip.JSZipObject
      ).async("nodebuffer");
      if (xlsxEntry) {
        workbook = XLSX.read(spreadsheetBuf, { type: "buffer" });
      } else {
        workbook = XLSX.read(spreadsheetBuf, {
          type: "buffer",
          raw: true,
          FS: ";",
        });
      }
    } else if (format === "csv") {
      workbook = XLSX.read(buffer, { type: "buffer", raw: true, FS: ";" });
    } else if (format === "xml") {
      return NextResponse.json(
        {
          error: "ERROR_XML_IMPORT_NOT_YET_IMPLEMENTED_PLEASE_USE_EX",
        },
        { status: 400 },
      );
    } else {
      workbook = XLSX.read(buffer, { type: "buffer" });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet) as any[];

    if (data.length === 0) {
      return NextResponse.json(
        { error: "ERROR_NO_DATA_FOUND_IN_FILE" },
        { status: 400 },
      );
    }

    // ── DDEX Column Validation ──
    // Check that required DDEX headers exist in the spreadsheet
    const fileHeaders = Object.keys(data[0] || {});
    const requiredHeaders = ["Release title"];
    const recommendedHeaders = [
      "Recording title",
      "Release artist",
      "Recording main artist",
      "Release format",
      "Release date",
    ];
    const ddexSignatureHeaders = [
      "Recording ISRC",
      "Release EAN / UPC",
      "Recording genre",
      "Recording explicit lyrics",
      "Recording duration",
      "Release type",
      "Release territories",
      "Recording label",
    ];

    const missingRequired = requiredHeaders.filter(
      (h) => !fileHeaders.includes(h),
    );
    const presentRecommended = recommendedHeaders.filter((h) =>
      fileHeaders.includes(h),
    );
    const presentSignature = ddexSignatureHeaders.filter((h) =>
      fileHeaders.includes(h),
    );

    // A file is considered DDEX-compliant if it has the required columns
    // AND at least some recommended/signature DDEX columns
    const isDdexCompliant =
      missingRequired.length === 0 &&
      (presentRecommended.length >= 2 || presentSignature.length >= 1);
    const missingRecommended = recommendedHeaders.filter(
      (h) => !fileHeaders.includes(h),
    );

    const validationResult = {
      isDdexCompliant,
      totalColumns: fileHeaders.length,
      totalRows: data.length,
      missingRequired,
      missingRecommended,
      presentDdexColumns: presentRecommended.length + presentSignature.length,
      errors: [] as string[],
    };

    if (missingRequired.length > 0) {
      validationResult.errors.push(
        `Missing required column(s): ${missingRequired.join(", ")}`,
      );
    }
    if (!isDdexCompliant && missingRequired.length === 0) {
      validationResult.errors.push(
        "File does not appear to be DDEX-compliant. Expected columns like: " +
          [...recommendedHeaders, ...ddexSignatureHeaders]
            .slice(0, 5)
            .join(", ") +
          ", etc.",
      );
    }

    // If validateOnly mode, return validation result immediately
    if (validateOnly) {
      return NextResponse.json({
        validation: validationResult,
        preview: {
          headers: fileHeaders.slice(0, 20),
          sampleRows: data.slice(0, 3).map((row) => {
            const sample: Record<string, string> = {};
            for (const h of fileHeaders.slice(0, 10)) {
              sample[h] = String(row[h] || "").substring(0, 100);
            }
            return sample;
          }),
        },
        zipInfo:
          format === "zip"
            ? {
                audioFiles: zipExtractedFiles.audio.size,
                artworkFiles: zipExtractedFiles.artwork.size,
                audioFileNames: Array.from(zipExtractedFiles.audio.keys()),
                artworkFileNames: Array.from(zipExtractedFiles.artwork.keys()),
              }
            : null,
      });
    }

    // Block non-DDEX files from import
    if (!isDdexCompliant) {
      return NextResponse.json(
        {
          error: "ERROR_FILE_IS_NOT_DDEX_COMPLIANT",
          validation: validationResult,
        },
        { status: 400 },
      );
    }

    // ── Group rows by Release title ──
    // Each row = 1 track; rows sharing the same "Release title" belong to the same release
    const releaseGroups = new Map<string, any[]>();

    for (const row of data) {
      const releaseTitle = col(row, "Release title");
      if (!releaseTitle) continue;
      if (!releaseGroups.has(releaseTitle)) {
        releaseGroups.set(releaseTitle, []);
      }
      releaseGroups.get(releaseTitle)!.push(row);
    }

    if (releaseGroups.size === 0) {
      return NextResponse.json(
        {
          error:
            'No releases found. Make sure your file has a "Release title" column.',
        },
        { status: 400 },
      );
    }

    // ================================================================
    // DRY RUN — validate data + check for missing audio/artwork files
    // ================================================================
    if (dryRun) {
      const missingFiles: {
        type: "audio" | "artwork";
        filename: string;
        releaseTitle: string;
      }[] = [];
      const checkedAudio = new Set<string>();
      const checkedArtwork = new Set<string>();
      const warnings: string[] = [];

      let totalTracks = 0;

      for (const [releaseTitle, rows] of releaseGroups) {
        totalTracks += rows.length;
        const first = rows[0];

        // Validate required fields
        if (!col(first, "Release artist", "Recording main artist")) {
          warnings.push(`Release "${releaseTitle}": No artist specified.`);
        }

        // Check for duplicate EAN/UPC
        const eanVal = col(first, "Release EAN / UPC", "Release EAN");
        if (eanVal) {
          const existingByEan = await prisma.release.findFirst({
            where: { ean: eanVal },
          });
          if (existingByEan) {
            warnings.push(
              `Release "${releaseTitle}": EAN/UPC "${eanVal}" already exists in "${existingByEan.title}". EAN will be skipped on import.`,
            );
          }
        }

        // Check for duplicate GRID
        const gridVal = col(first, "Release GRID");
        if (gridVal) {
          const existingByGrid = await prisma.release.findFirst({
            where: { grid: gridVal },
          });
          if (existingByGrid) {
            warnings.push(
              `Release "${releaseTitle}": GRID "${gridVal}" already exists. GRID will be skipped on import.`,
            );
          }
        }

        // Check artwork
        const rawArtworkFile = col(first, "Release cover image file name");
        const artworkFile = rawArtworkFile ? path.basename(rawArtworkFile) : "";
        if (artworkFile && !checkedArtwork.has(artworkFile)) {
          checkedArtwork.add(artworkFile);
          // Check: ZIP-extracted → on-disk → database
          const fromZip = zipExtractedFiles.artwork.has(artworkFile);
          let onDisk = false;
          try {
            await fs.promises.access(
              path.join(UPLOAD_ROOT, "covers", artworkFile),
            );
            onDisk = true;
          } catch {
            /* not on disk */
          }
          const inDb =
            (await prisma.asset.findFirst({
              where: {
                OR: [
                  { fileName: artworkFile },
                  { originalFileName: artworkFile },
                ],
              },
            })) ||
            (await prisma.release.findFirst({
              where: { coverUrl: { contains: artworkFile } },
            }));
          if (!fromZip && !onDisk && !inDb) {
            missingFiles.push({
              type: "artwork",
              filename: artworkFile,
              releaseTitle,
            });
          }
        }

        // Check audio files
        for (const row of rows) {
          const rawAudioFile = col(row, "Recording audio file name");
          const audioFile = rawAudioFile ? path.basename(rawAudioFile) : "";
          if (audioFile && !checkedAudio.has(audioFile)) {
            checkedAudio.add(audioFile);
            const fromZip = zipExtractedFiles.audio.has(audioFile);
            let onDisk = false;
            try {
              await fs.promises.access(
                path.join(UPLOAD_ROOT, "audio", audioFile),
              );
              onDisk = true;
            } catch {
              /* not on disk */
            }
            const inDb = await prisma.asset.findFirst({
              where: {
                OR: [{ fileName: audioFile }, { originalFileName: audioFile }],
              },
            });
            if (!fromZip && !onDisk && !inDb) {
              missingFiles.push({
                type: "audio",
                filename: audioFile,
                releaseTitle,
              });
            }
          }

          // Validate ISRC format and check for duplicates
          const isrc = col(row, "Recording ISRC");
          if (isrc) {
            if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc.replace(/-/g, ""))) {
              warnings.push(
                `Track "${col(row, "Recording title")}" in "${releaseTitle}": Invalid ISRC format "${isrc}".`,
              );
            }
            const existingByIsrc = await prisma.track.findFirst({
              where: { isrc },
            });
            if (existingByIsrc) {
              warnings.push(
                `Track "${col(row, "Recording title")}" in "${releaseTitle}": ISRC "${isrc}" already exists. ISRC will be skipped on import.`,
              );
            }
          }

          // Validate Composition Authors splits
          const authors = parseAuthors(row);
          if (authors.length > 0) {
            const hasAnyShare = authors.some(
              (a) => a.share !== undefined && a.share !== null,
            );
            if (hasAnyShare) {
              const totalShare = authors.reduce(
                (sum: number, a: { share?: number }) => sum + (a.share || 0),
                0,
              );
              if (Math.abs(totalShare - 100) > 0.01) {
                warnings.push(
                  `Track "${col(row, "Recording title")}" in "${releaseTitle}": Composition author shares total ${totalShare}%. It MUST equal exactly 100% for DDEX compliance.`,
                );
              }
            }
          }
        }
      }

      return NextResponse.json({
        missingFiles,
        warnings,
        summary: {
          releases: releaseGroups.size,
          tracks: totalTracks,
          missingAudio: missingFiles.filter((f) => f.type === "audio").length,
          missingArtwork: missingFiles.filter((f) => f.type === "artwork")
            .length,
          zipAudioExtracted: zipExtractedFiles.audio.size,
          zipArtworkExtracted: zipExtractedFiles.artwork.size,
        },
        message:
          missingFiles.length > 0
            ? `Found ${missingFiles.length} missing file(s). Please upload them before importing.`
            : `Validation passed. Ready to import ${releaseGroups.size} release(s) with ${totalTracks} track(s).` +
              (zipExtractedFiles.audio.size > 0
                ? ` (${zipExtractedFiles.audio.size} audio + ${zipExtractedFiles.artwork.size} artwork files extracted from ZIP)`
                : ""),
      });
    }

    // ================================================================
    // ACTUAL IMPORT — Process each release in a Prisma transaction
    // ================================================================
    const results = {
      releases: { created: 0, failed: 0 },
      tracks: { created: 0, failed: 0 },
      assets: { created: 0, linked: 0 },
      compositions: { created: 0 },
      artists: { created: 0, reused: 0 },
      labels: { created: 0, reused: 0 },
      errors: [] as string[],
      warnings: [] as string[],
    };

    // Cache for artists & labels to avoid duplicate DB lookups across releases
    const artistCache = new Map<string, string>(); // name → id
    const labelCache = new Map<string, string>(); // name → id

    // Pre-fetch scope for ownership validation (B2B2B entity hierarchy)
    const userIsAdmin = isSystemAdmin(session);
    const accessibleEntityIds = userIsAdmin ? [] : await getAccessibleEntityIds(session.entityId);

    for (const [releaseTitle, rows] of releaseGroups) {
      try {
        // Process entire release in a transaction for atomicity
        await prisma.$transaction(
          async (tx: any) => {
            const first = rows[0];

            // ── 1. Label ──
            let labelId: string | null = null;
            const labelName = col(first, "Recording label", "Release label");
            if (labelName) {
              if (labelCache.has(labelName)) {
                labelId = labelCache.get(labelName)!;
                results.labels.reused++;
              } else {
                // Check if label already exists in DB (inside tx for consistency)
                const existingLabel = await tx.label.findFirst({
                  where: userIsAdmin
                    ? { name: labelName }
                    : { name: labelName, tenantId: { in: accessibleEntityIds } },
                });
                if (existingLabel) {
                  labelId = existingLabel.id;
                  results.labels.reused++;
                } else {
                  if (!session.tenantId) {
                    throw new Error(`Cannot create label without a tenant context.`);
                  }
                  const newLabel = await tx.label.create({
                    data: {
                      name: labelName,
                      tenantId: session.tenantId,
                    },
                  });
                  labelId = newLabel.id;
                  results.labels.created++;
                }
                labelCache.set(labelName, labelId);
              }
            }

            // ── 2. Release Artist ──
            let releaseArtistId: string | null = null;
            const releaseArtistName = col(
              first,
              "Release artist",
              "Recording main artist",
            );
            const releaseArtistIsni = col(
              first,
              "Release artist ISNI",
              "Recording main artist ISNI",
            );
            const releaseArtistDpid = col(
              first,
              "Release artist DPID",
              "Recording main artist DPID",
            );
            if (releaseArtistName) {
              const firstName = splitList(releaseArtistName)[0];
              if (firstName) {
                if (artistCache.has(firstName)) {
                  releaseArtistId = artistCache.get(firstName)!;
                  results.artists.reused++;
                } else {
                  const existingArtist = await tx.artist.findFirst({
                    where: userIsAdmin
                      ? { name: firstName }
                      : { name: firstName, tenantId: { in: accessibleEntityIds } },
                  });
                  if (existingArtist) {
                    releaseArtistId = existingArtist.id;
                    results.artists.reused++;
                    // Update ISNI/DPID if newly available from import data
                    if (
                      (releaseArtistIsni && !existingArtist.isni) ||
                      (releaseArtistDpid && !existingArtist.dpid)
                    ) {
                      await tx.artist.update({
                        where: { id: existingArtist.id },
                        data: {
                          ...(releaseArtistIsni && !existingArtist.isni
                            ? { isni: releaseArtistIsni }
                            : {}),
                          ...(releaseArtistDpid && !existingArtist.dpid
                            ? { dpid: releaseArtistDpid }
                            : {}),
                        },
                      });
                    }
                  } else {
                    if (!session.tenantId) {
                      throw new Error(`Cannot create artist without a tenant context.`);
                    }
                    const newArtist = await tx.artist.create({
                      data: {
                        name: firstName,
                        isni: releaseArtistIsni || null,
                        dpid: releaseArtistDpid || null,
                        tenantId: session.tenantId,
                      },
                    });
                    releaseArtistId = newArtist.id;
                    results.artists.created++;
                  }
                  artistCache.set(firstName, releaseArtistId);
                }
              }
            }

            // ── 3. Release territories ──
            const territoriesRaw =
              col(first, "Release territories") || "WORLDWIDE";
            const territories =
              territoriesRaw.toUpperCase() === "WORLDWIDE"
                ? "WORLDWIDE"
                : splitList(territoriesRaw).join(",");

            // ── 4. Parse release date ──
            const releaseDateStr = col(first, "Release date");
            const releaseDate = parseDate(releaseDateStr) || new Date();
            const originalReleaseDateStr = col(
              first,
              "Release original release date",
            );
            const originalReleaseDate = parseDate(originalReleaseDateStr);

            // ── 5. Cover image ──
            let coverUrl: string | null = null;
            const rawCoverFileName = col(first, "Release cover image file name");
            const coverFileName = rawCoverFileName ? path.basename(rawCoverFileName) : null;
            if (coverFileName) {
              const coverAsset = await findAssetByFilename(tx, coverFileName, userIsAdmin, userScopeIds);
              if (coverAsset) {
                coverUrl = coverAsset.fileUrl;
              } else {
                // Try to construct URL from upload server path
                coverUrl = `/uploads/covers/${coverFileName}`;
              }
            }

            // ── 6. Create Release (with unique constraint checks) ──
            const ean = col(first, "Release EAN / UPC", "Release EAN") || null;
            const grid = col(first, "Release GRID") || null;

            // Check for duplicate EAN (store result to avoid TOCTOU race)
            let eanIsDuplicate = false;
            if (ean) {
              const existingByEan = await tx.release.findFirst({
                where: { ean },
              });
              if (existingByEan) {
                eanIsDuplicate = true;
                results.warnings.push(
                  `Release "${releaseTitle}": EAN/UPC "${ean}" already exists (release "${existingByEan.title}"). Skipping EAN.`,
                );
              }
            }
            // Check for duplicate GRID (store result to avoid TOCTOU race)
            let gridIsDuplicate = false;
            if (grid) {
              const existingByGrid = await tx.release.findFirst({
                where: { grid },
              });
              if (existingByGrid) {
                gridIsDuplicate = true;
                results.warnings.push(
                  `Release "${releaseTitle}": GRID "${grid}" already exists. Skipping GRID.`,
                );
              }
            }

            const release = await tx.release.create({
              data: {
                title: releaseTitle,
                titleLocalized: parseLocalized(
                  col(first, "Release title localized"),
                ),
                subtitle: col(first, "Release subtitle") || null,
                subtitleLocalized: parseLocalized(
                  col(first, "Release subtitle localized"),
                ),
                ean: ean && !eanIsDuplicate ? ean : null,
                grid: grid && !gridIsDuplicate ? grid : null,
                catalogueNumber: col(first, "Release catalogue number") || null,
                type:
                  col(first, "Release type") === "VIDEO" ? "VIDEO" : "AUDIO",
                format: normalizeFormat(
                  col(first, "Release format") || "SINGLE",
                ),
                genre: col(first, "Release genre") || null,
                subGenre: col(first, "Release sub-genre") || null,
                releaseDate,
                originalReleaseDate,
                metaLanguage: col(first, "Release meta language") || "en",
                artistId: releaseArtistId,
                displayArtist: col(first, "Release artist") || null,
                displayArtistLocalized: parseLocalized(
                  col(first, "Release artist localized"),
                ),
                labelId,
                pLine: col(first, "Release p-line text") || null,
                cLine: col(first, "Release c-line text") || null,
                pLineYear: safeInt(col(first, "Release p-line year")),
                cLineYear: safeInt(col(first, "Release c-line year")),
                coverUrl,
                coverImageFileName: coverFileName || null,
                territories,
                excludingTerritories:
                  col(first, "Release excluding territories") || null,
                outlets: col(first, "Release outlets") || null,
                status: "DRAFT",
                tenantId: session.tenantId!,
                ownerId: session.entityId,
              },
            });

            results.releases.created++;

            // ── 7. Process each track row ──
            for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
              const row = rows[rowIdx];
              const trackTitle =
                col(row, "Recording title") || `Track ${rowIdx + 1}`;

              try {
                // ── 7a. Audio Asset — find or create ──
                let audioAssetId: string | null = null;
                const rawAudioFileName = col(row, "Recording audio file name");
                const audioFileName = rawAudioFileName
                  ? path.basename(rawAudioFileName)
                  : "";
                if (audioFileName) {
                  const existingAsset = await findAssetByFilename(
                    tx,
                    audioFileName,
                    userIsAdmin,
                    userScopeIds
                  );
                  if (existingAsset) {
                    // Link existing asset to this release
                    audioAssetId = existingAsset.id;
                    if (!existingAsset.releaseId) {
                      await tx.asset.update({
                        where: { id: existingAsset.id },
                        data: { releaseId: release.id },
                      });
                    }
                    results.assets.linked++;
                  } else {
                    // Create new asset record (file was extracted from ZIP or manually uploaded)
                    const audioFilePath =
                      col(row, "Recording audio file path") ||
                      `/uploads/audio/${audioFileName}`;
                    const codec = col(row, "Recording audio codec") || null;
                    const mimeMap: Record<string, string> = {
                      FLAC: "audio/flac",
                      WAV: "audio/wav",
                      MP3: "audio/mpeg",
                      AAC: "audio/aac",
                      OGG: "audio/ogg",
                      AIFF: "audio/aiff",
                      M4A: "audio/mp4",
                      ALAC: "audio/mp4",
                      WMA: "audio/x-ms-wma",
                    };

                    // Auto-detect codec from extension if not specified
                    let detectedCodec = codec;
                    if (!detectedCodec) {
                      const ext =
                        audioFileName.split(".").pop()?.toUpperCase() || "";
                      if (mimeMap[ext]) detectedCodec = ext;
                    }

                    // Get file size if file exists on disk (e.g., from ZIP extract)
                    let fileSize: bigint | null = null;
                    const diskPath = path.join(
                      UPLOAD_ROOT,
                      "audio",
                      audioFileName,
                    );
                    try {
                      const stat = await fs.promises.stat(diskPath);
                      fileSize = BigInt(stat.size);
                    } catch {
                      /* file not on disk, skip */
                    }

                    const newAsset = await tx.asset.create({
                      data: {
                        type: "AUDIO",
                        fileName: audioFileName,
                        originalFileName: audioFileName,
                        fileUrl: audioFilePath,
                        fileSize,
                        mimeType: detectedCodec
                          ? mimeMap[detectedCodec.toUpperCase()] || "audio/mpeg"
                          : "audio/mpeg",
                        duration: safeInt(col(row, "Recording duration")),
                        sampleRate: safeInt(col(row, "Recording sample rate")),
                        bitRate: safeInt(col(row, "Recording bit rate")),
                        channels: safeInt(
                          col(row, "Recording number of channels"),
                        ),
                        codec: detectedCodec,
                        isrc: col(row, "Recording ISRC") || null,
                        releaseId: release.id,
                        status: "READY",
                        createdById: session.id,
                      },
                    });
                    audioAssetId = newAsset.id;
                    results.assets.created++;
                  }
                }

                // ── 7b. Composition — create if author data present ──
                let compositionId: string | null = null;
                const authors = parseAuthors(row);
                const compositionTitle = col(row, "Composition title");
                const iswc = col(row, "Composition ISWC");

                if (compositionTitle || authors.length > 0 || iswc) {
                  // Check for existing composition by ISWC
                  let existingComp = null;
                  if (iswc) {
                    existingComp = await tx.composition.findFirst({
                      where: { iswc },
                    });
                  }

                  if (existingComp) {
                    compositionId = existingComp.id;
                  } else {
                    const comp = await tx.composition.create({
                      data: {
                        title: compositionTitle || trackTitle,
                        titleLocalized: parseLocalized(
                          col(row, "Composition title localized"),
                        ),
                        subtitle: col(row, "Composition subtitle") || null,
                        subtitleLocalized: parseLocalized(
                          col(row, "Composition subtitle localized"),
                        ),
                        alternativeTitle:
                          col(row, "Composition alternative title") || null,
                        alternativeTitleLocalized: parseLocalized(
                          col(row, "Composition alternative title localized"),
                        ),
                        iswc: iswc || null,
                        catalogueNumber:
                          col(row, "Composition catalogue number") || null,
                        genre: col(row, "Composition genre") || null,
                        creationDate: parseDate(
                          col(row, "Composition creation date"),
                        ),
                        lyricsLanguages:
                          col(row, "Composition lyrics languages") || null,
                        lyricsFileName:
                          col(row, "Composition lyrics file name") || null,
                        territories:
                          col(row, "Composition territories") || "WORLDWIDE",
                        excludingTerritories:
                          col(row, "Composition excluding territories") || null,
                        contractPeriodBegins: parseDate(
                          col(row, "Composition contract period begins"),
                        ),
                        contractPeriodEnds: parseDate(
                          col(row, "Composition contract period ends"),
                        ),
                        contractNumber:
                          col(row, "Composition contract number") || null,
                        authors: authors.length > 0 ? authors : undefined,
                        createdById: session.id,
                      },
                    });
                    compositionId = comp.id;
                    results.compositions.created++;
                  }
                }

                // ── 7c. Track Artist ──
                let trackArtistId: string | null = null;
                const mainArtistName = col(row, "Recording main artist");
                const mainArtistIsni = col(row, "Recording main artist ISNI");
                const mainArtistDpid = col(row, "Recording main artist DPID");
                if (mainArtistName) {
                  const firstMainArtist = splitList(mainArtistName)[0];
                  if (firstMainArtist) {
                    if (artistCache.has(firstMainArtist)) {
                      trackArtistId = artistCache.get(firstMainArtist)!;
                      results.artists.reused++;
                    } else {
                      const existingArtist = await tx.artist.findFirst({
                        where: { name: firstMainArtist },
                      });
                      if (existingArtist) {
                        trackArtistId = existingArtist.id;
                        results.artists.reused++;
                        // Update ISNI/DPID if newly available
                        if (
                          (mainArtistIsni && !existingArtist.isni) ||
                          (mainArtistDpid && !existingArtist.dpid)
                        ) {
                          await tx.artist.update({
                            where: { id: existingArtist.id },
                            data: {
                              ...(mainArtistIsni && !existingArtist.isni
                                ? { isni: mainArtistIsni }
                                : {}),
                              ...(mainArtistDpid && !existingArtist.dpid
                                ? { dpid: mainArtistDpid }
                                : {}),
                            },
                          });
                        }
                      } else {
                        const newArtist = await tx.artist.create({
                          data: {
                            name: firstMainArtist,
                            isni: mainArtistIsni || null,
                            dpid: mainArtistDpid || null,
                            createdById: session.id,
                          },
                        });
                        trackArtistId = newArtist.id;
                        results.artists.created++;
                      }
                      artistCache.set(firstMainArtist, trackArtistId);
                    }
                  }
                }

                // ── 7d. Featured artists JSON ──
                const featuredArtists = parseFeaturedArtists(row);

                // ── 7e. Contributors JSON ──
                const contributors = parseContributors(row);

                // ── 7f. Track territories ──
                const trackTerrRaw =
                  col(row, "Recording territories") || "WORLDWIDE";
                const trackTerritories =
                  trackTerrRaw.toUpperCase() === "WORLDWIDE"
                    ? "WORLDWIDE"
                    : splitList(trackTerrRaw).join(",");

                // ── 7g. Create Track (with ISRC duplicate check) ──
                const trackIsrc = col(row, "Recording ISRC") || null;
                let safeIsrc = trackIsrc;
                if (trackIsrc) {
                  const existingByIsrc = await tx.track.findFirst({
                    where: { isrc: trackIsrc },
                  });
                  if (existingByIsrc) {
                    results.warnings.push(
                      `Track "${trackTitle}": ISRC "${trackIsrc}" already exists. Skipping ISRC to avoid duplicate.`,
                    );
                    safeIsrc = null;
                  }
                }

                await tx.track.create({
                  data: {
                    releaseId: release.id,
                    title: trackTitle,
                    titleLocalized: parseLocalized(
                      col(row, "Recording title localized"),
                    ),
                    subtitle: col(row, "Recording subtitle") || null,
                    subtitleLocalized: parseLocalized(
                      col(row, "Recording subtitle localized"),
                    ),
                    alternativeTitle:
                      col(row, "Recording alternative title") || null,
                    alternativeTitleLocalized: parseLocalized(
                      col(row, "Recording alternative title localized"),
                    ),
                    isrc: safeIsrc,
                    catalogueNumber:
                      col(row, "Recording catalogue number") || null,
                    trackNumber:
                      safeInt(col(row, "Release track number")) || rowIdx + 1,
                    discNumber: safeInt(col(row, "Release disc number")) || 1,
                    duration: safeInt(col(row, "Recording duration")),
                    genre: col(row, "Recording genre") || null,
                    explicitLyrics: parseExplicit(
                      col(row, "Recording explicit lyrics"),
                    ),
                    lyrics: col(row, "Composition lyrics text") || null,
                    lyricsLanguage:
                      col(
                        row,
                        "Composition lyrics languages",
                        "Recording language of performance",
                      ) || null,
                    creationDate: parseDate(
                      col(row, "Recording creation date"),
                    ),
                    countryOfCreation:
                      col(row, "Recording country of creation") || null,
                    artistId: trackArtistId,
                    displayArtist: mainArtistName || null,
                    displayArtistLocalized: parseLocalized(
                      col(row, "Recording main artist localized"),
                    ),
                    featuredArtists:
                      featuredArtists.length > 0 ? featuredArtists : undefined,
                    contributors:
                      contributors.performers.length > 0 ||
                      contributors.studioPersonnel.length > 0 ||
                      contributors.indirectContributors.length > 0
                        ? contributors
                        : undefined,
                    producer: col(row, "Recording producer") || null,
                    producerLocalized: parseLocalized(
                      col(row, "Recording producer localized"),
                    ),
                    producerShare: safeDecimal(
                      col(row, "Recording producer share"),
                    ),
                    remixer: col(row, "Recording remixer") || null,
                    conductor: col(row, "Recording conductor") || null,
                    conductorLocalized: parseLocalized(
                      col(row, "Recording conductor localized"),
                    ),
                    conductorShare: safeDecimal(
                      col(row, "Recording conductor share"),
                    ),
                    recordingLabel: col(row, "Recording label") || null,
                    recordingLabelLocalized: parseLocalized(
                      col(row, "Recording label localized"),
                    ),
                    recordingLabelShare: safeDecimal(
                      col(row, "Recording label share"),
                    ),
                    territories: trackTerritories,
                    excludingTerritories:
                      col(row, "Recording excluding territories") || null,
                    contractPeriodBegins: parseDate(
                      col(row, "Recording contract period begins"),
                    ),
                    contractPeriodEnds: parseDate(
                      col(row, "Recording contract period ends"),
                    ),
                    contractNumber:
                      col(row, "Recording contract number") || null,
                    audioAssetId: audioAssetId,
                    snippetStart: safeInt(col(row, "Recording snippet start")),
                    snippetEnd: safeInt(col(row, "Recording snippet end")),
                    compositionId,
                    createdById: session.id,
                  },
                });

                results.tracks.created++;
              } catch (trackError) {
                results.tracks.failed++;
                const msg =
                  trackError instanceof Error
                    ? trackError.message
                    : "Unknown error";
                results.errors.push(
                  `Track "${trackTitle}" in "${releaseTitle}": ${msg}`,
                );
                console.error(
                  `Error importing track "${trackTitle}":`,
                  trackError,
                );
              }
            }
          },
          { timeout: 360000 },
        ); // 360s timeout per release batch
      } catch (releaseError) {
        results.releases.failed++;
        const msg =
          releaseError instanceof Error
            ? releaseError.message
            : "Unknown error";
        results.errors.push(`Release "${releaseTitle}": ${msg}`);
        console.error(
          `Error importing release "${releaseTitle}":`,
          releaseError,
        );
      }
    }

    // ── Build summary message ──
    const parts: string[] = [];
    if (results.releases.created > 0)
      parts.push(`${results.releases.created} release(s) created`);
    if (results.tracks.created > 0)
      parts.push(`${results.tracks.created} track(s) created`);
    if (results.assets.created > 0)
      parts.push(`${results.assets.created} asset(s) created`);
    if (results.assets.linked > 0)
      parts.push(`${results.assets.linked} asset(s) linked`);
    if (results.compositions.created > 0)
      parts.push(`${results.compositions.created} composition(s) created`);
    if (results.releases.failed > 0)
      parts.push(`${results.releases.failed} release(s) failed`);
    if (results.tracks.failed > 0)
      parts.push(`${results.tracks.failed} track(s) failed`);

    return NextResponse.json({
      message: `Import completed: ${parts.join(", ")}`,
      results,
    });
  } catch (error) {
    console.error("Error importing releases:", error);
    return NextResponse.json(
      {
        error: "ERROR_FAILED_TO_IMPORT_RELEASES",
      },
      { status: 500 },
    );
  }
}
