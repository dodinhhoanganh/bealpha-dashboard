import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import JSZip from "jszip";
import fs from "fs";
import path from "path";

const UPLOAD_ROOT =
  process.env.UPLOAD_DIR ||
  path.join(process.cwd(), "..", "bealpha-upload-server", "uploads");

export const maxDuration = 300; // 5 minutes max duration for large zip generation

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function canAccessLabel(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  labelId: string,
): Promise<boolean> {
  if (isSystemAdmin(session)) return true;

  const label = await prisma.label.findUnique({
    where: { id: labelId },
    select: { tenantId: true },
  });
  if (!label) return false;

  const accessibleIds = await getAccessibleEntityIds(session.entityId);
  return accessibleIds.includes(label.tenantId);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // A4 fix: use getSecureSession — data export must block banned/deactivated users
    const session = await getSecureSession();
    if (!session)
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });

    // Check permission (needs read access to the label)
    if (!hasPermission(session, PERMISSIONS.LABEL_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessLabel(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // 1. Fetch full Label database tree
    const labelData = await prisma.label.findUnique({
      where: { id },
      include: {
        artists: true,
        releases: {
          include: {
            tracks: {
              include: {
                audioAsset: true,
                composition: true,
                contributors: true,
              },
            },
            assets: true,
          },
        },
        ddexMessages: true,
      },
    });

    if (!labelData) {
      return NextResponse.json({ error: "ERROR_LABEL_NOT_FOUND" }, { status: 404 });
    }

    // Prepare Zip
    const zip = new JSZip();

    // 2. Add metadata.json
    zip.file("database_dump.json", JSON.stringify(labelData, null, 2));

    // 3. Collect physical files based on tenant hierarchy
    const addedFiles = new Set<string>();

    const sanitizeFilename = (name: string) => {
      if (!name) return "";
      const base = path.basename(name);
      let out = base
        .replace(/[<>:"|\\?*\x00-\x1f]/g, "_")
        .replace(/\.\./g, "_")
        .replace(/\s+/g, " ")
        .trim();
      if (out.length > 200) out = out.slice(0, 200);
      return out;
    };

    const safeLabelName = sanitizeFilename(labelData.name); // Match server.js logic exactly
    const labelFolderPath = path.join(UPLOAD_ROOT, safeLabelName);

    // If the label's folder exists in the uploads directory, recursively zip its contents
    if (fs.existsSync(labelFolderPath)) {
      const addFolderToZip = async (folderPath: string, zipFolder: JSZip) => {
        const files = await fs.promises.readdir(folderPath, {
          withFileTypes: true,
        });
        for (const file of files) {
          const fullPath = path.join(folderPath, file.name);
          if (file.isDirectory()) {
            await addFolderToZip(fullPath, zipFolder.folder(file.name)!);
          } else {
            const fileData = await fs.promises.readFile(fullPath);
            zipFolder.file(file.name, fileData);
          }
        }
      };

      const labelZipFolder = zip.folder(`uploads/${safeLabelName}`)!;
      await addFolderToZip(labelFolderPath, labelZipFolder);
    } else {
      // Fallback: If folder doesn't exist natively by tenant name, try extracting individual files from DB URLs.
      // E.g. Label Logo
      if (labelData.logoUrl) {
        try {
          const relativePath = decodeURIComponent(
            new URL(labelData.logoUrl).pathname.replace(/^\/?uploads\//, ""),
          );
          // Security: prevent path traversal
          if (
            relativePath &&
            !relativePath.includes("..") &&
            !path.isAbsolute(relativePath)
          ) {
            const fullPath = path.join(UPLOAD_ROOT, relativePath);
            const resolved = path.resolve(fullPath);
            if (
              resolved.startsWith(path.resolve(UPLOAD_ROOT)) &&
              fs.existsSync(fullPath)
            ) {
              zip.file(
                `uploads/${relativePath}`,
                await fs.promises.readFile(fullPath),
              );
            }
          }
        } catch {}
      }

      // Artist avatars
      for (const artist of labelData.artists) {
        if (artist.imageUrl) {
          try {
            const relativePath = decodeURIComponent(
              new URL(artist.imageUrl).pathname.replace(/^\/?uploads\//, ""),
            );
            if (
              relativePath &&
              !relativePath.includes("..") &&
              !path.isAbsolute(relativePath)
            ) {
              const fullPath = path.join(UPLOAD_ROOT, relativePath);
              const resolved = path.resolve(fullPath);
              if (
                resolved.startsWith(path.resolve(UPLOAD_ROOT)) &&
                fs.existsSync(fullPath)
              ) {
                zip.file(
                  `uploads/${relativePath}`,
                  await fs.promises.readFile(fullPath),
                );
              }
            }
          } catch {}
        }
      }

      // Covers and Audio
      for (const release of labelData.releases) {
        if (release.coverUrl) {
          try {
            const relativePath = decodeURIComponent(
              new URL(release.coverUrl).pathname.replace(/^\/?uploads\//, ""),
            );
            if (
              relativePath &&
              !relativePath.includes("..") &&
              !path.isAbsolute(relativePath)
            ) {
              const fullPath = path.join(UPLOAD_ROOT, relativePath);
              const resolved = path.resolve(fullPath);
              if (
                resolved.startsWith(path.resolve(UPLOAD_ROOT)) &&
                fs.existsSync(fullPath)
              ) {
                zip.file(
                  `uploads/${relativePath}`,
                  await fs.promises.readFile(fullPath),
                );
              }
            }
          } catch {}
        }
        for (const track of release.tracks) {
          if (track.audioAsset?.fileName) {
            // fileName is now the relative path like Label/Artist/Release/audio/file.wav
            const safeName = track.audioAsset.fileName;
            if (
              safeName &&
              !safeName.includes("..") &&
              !path.isAbsolute(safeName)
            ) {
              const fullPath = path.join(UPLOAD_ROOT, safeName);
              const resolved = path.resolve(fullPath);
              if (
                resolved.startsWith(path.resolve(UPLOAD_ROOT)) &&
                fs.existsSync(fullPath)
              ) {
                zip.file(
                  `uploads/${safeName}`,
                  await fs.promises.readFile(fullPath),
                );
              } else if (track.audioAsset.fileUrl) {
                try {
                  const relativePath = decodeURIComponent(
                    new URL(track.audioAsset.fileUrl).pathname.replace(
                      /^\/?uploads\//,
                      "",
                    ),
                  );
                  if (
                    relativePath &&
                    !relativePath.includes("..") &&
                    !path.isAbsolute(relativePath)
                  ) {
                    const fallbackPath = path.join(UPLOAD_ROOT, relativePath);
                    const resolvedFallback = path.resolve(fallbackPath);
                    if (
                      resolvedFallback.startsWith(path.resolve(UPLOAD_ROOT)) &&
                      fs.existsSync(fallbackPath)
                    ) {
                      zip.file(
                        `uploads/${relativePath}`,
                        await fs.promises.readFile(fallbackPath),
                      );
                    }
                  }
                } catch {}
              }
            }
          }
        }
      }
    }

    // 4. Generate the ZIP stream (prevent OOM)
    const nodeStream = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "DEFLATE",
      compressionOptions: { level: 5 }, // Balanced compression for large audio files
    });

    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
    });

    const dateStr = new Date().toISOString().split("T")[0];
    return new NextResponse(webStream as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeLabelName.replace(/\s+/g, "_")}_Backup_${dateStr}.zip"`,
      },
    });
  } catch (error) {
    console.error("Backup generation error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_GENERATE_BACKUP" },
      { status: 500 },
    );
  }
}
