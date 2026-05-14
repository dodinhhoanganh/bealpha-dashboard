/**
 * Release Scheduling Cron API
 *
 * Checks for scheduled releases that have reached their release date
 * and automatically transitions them to RELEASED status.
 *
 * Call this endpoint via an external cron service (e.g. Vercel Cron, GitHub Actions)
 * every 5-15 minutes using a secret bearer token.
 *
 * GET  /api/cron/release-scheduler  — Run the scheduler
 *
 * Headers:
 *   Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { timingSafeEqual } from "crypto";

const CRON_SECRET = process.env.CRON_SECRET;

function verifyCronAuth(request: NextRequest): boolean {
  // In production, CRON_SECRET must be set
  if (!CRON_SECRET) {
    console.error(
      "[CRON] CRON_SECRET is not configured — rejecting all requests",
    );
    return false;
  }

  // Bearer token auth only — x-vercel-cron header is spoofable
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const provided = auth.slice(7);
    // B11 fix: constant-time comparison to prevent timing attacks
    if (provided.length !== CRON_SECRET.length) return false;
    return timingSafeEqual(Buffer.from(provided), Buffer.from(CRON_SECRET));
  }

  return false;
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const now = new Date();

    // 1. Find all SCHEDULED releases where releaseDate <= now
    const scheduledReleases = await prisma.release.findMany({
      where: {
        status: "SCHEDULED",
        releaseDate: { lte: now },
      },
      select: {
        id: true,
        title: true,
        releaseDate: true,
        ownerId: true,
        tracks: {
          select: {
            id: true,
            audioAssetId: true,
          },
        },
      },
    });

    if (scheduledReleases.length === 0) {
      return NextResponse.json({
        message: "No releases to process",
        processed: 0,
        timestamp: now.toISOString(),
      });
    }

    const results: Array<{
      id: string;
      title: string;
      status: "released" | "failed";
      reason?: string;
    }> = [];

    for (const release of scheduledReleases) {
      try {
        // 2. Pre-release validation
        const issues: string[] = [];

        if (!release.tracks || release.tracks.length === 0) {
          issues.push("No tracks attached");
        }

        const missingAudio =
          release.tracks?.filter((t: { audioAssetId: string | null }) => !t.audioAssetId) || [];
        if (missingAudio.length > 0) {
          issues.push(`${missingAudio.length} track(s) missing audio files`);
        }

        if (issues.length > 0) {
          // Mark as DRAFT with issues noted — don't auto-release broken content
          await prisma.release.update({
            where: { id: release.id },
            data: {
              status: "DRAFT",
            },
          });

          // Create notification for the owner
          try {
            if (release.ownerId)
              await prisma.notification.create({
                data: {
                  userId: release.ownerId,
                  type: "release_denied",
                  title: "Scheduled Release Failed",
                  message: `"${release.title}" could not be auto-released: ${issues.join(", ")}. Status reverted to Draft.`,
                  link: `/releases/${release.id}`,
                  metadata: { issues },
                },
              });
          } catch {
            // Notification failure shouldn't block the cron
          }

          results.push({
            id: release.id,
            title: release.title,
            status: "failed",
            reason: issues.join("; "),
          });
          continue;
        }

        // 3. Transition to RELEASED
        await prisma.release.update({
          where: { id: release.id },
          data: {
            status: "DELIVERED",
          },
        });

        // 4. Create AuditLog entry
        try {
          await prisma.auditLog.create({
            data: {
              action: "UPDATE",
              entityType: "Release",
              entityId: release.id,
              oldValue: { status: "SCHEDULED" },
              newValue: { status: "DELIVERED", trigger: "cron-scheduler" },
            },
          });
        } catch {
          // AuditLog failure shouldn't block the transition
        }

        // 5. Notify the release owner
        try {
          if (release.ownerId)
            await prisma.notification.create({
              data: {
                userId: release.ownerId,
                type: "release_released",
                title: "Release Now Live!",
                message: `"${release.title}" has been automatically released as scheduled.`,
                link: `/releases/${release.id}`,
              },
            });
        } catch {
          // Notification failure shouldn't block
        }

        results.push({
          id: release.id,
          title: release.title,
          status: "released",
        });
      } catch (err) {
        results.push({
          id: release.id,
          title: release.title,
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const released = results.filter((r) => r.status === "released").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      message: `Processed ${results.length} release(s): ${released} released, ${failed} failed`,
      processed: results.length,
      released,
      failed,
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Cron release-scheduler error:", error);
    return NextResponse.json(
      { error: "ERROR_INTERNAL_SERVER_ERROR" },
      { status: 500 },
    );
  }
}
