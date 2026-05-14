import { NextRequest } from "next/server";
import { getSecureSession } from "@/lib/auth";

/**
 * POST /api/stream/sign
 * Proxy to upload server's /stream/sign endpoint.
 * Requires authenticated session (no anonymous stream signing).
 */
export async function POST(req: NextRequest) {
  try {
    // Require authenticated session
    const session = await getSecureSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "ERROR_NOT_AUTHENTICATED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const paths: string[] = body.paths || [];

    // Security: Strict path traversal prevention
    if (paths.some(p => /(^|\/)\.\.(\/|$)/.test(p))) {
      return new Response(JSON.stringify({ error: "ERROR_INVALID_PATH" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // B2B2B Security: Check if user has access to the requested asset paths
    const { isSystemAdmin } = await import("@/lib/auth");
    if (!isSystemAdmin(session) && paths.length > 0) {
      const { prisma } = await import("@/lib/prisma");
      const { getAccessibleEntityIds } = await import("@/lib/entity-hierarchy");
      
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      
      // UUID regex to find asset ID inside path
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

      for (const path of paths) {
        const match = path.match(uuidRegex);
        if (match) {
          const uuid = match[0];
          // Check if this UUID is in any asset the user has access to
          const asset = await prisma.asset.findFirst({
            where: {
              fileUrl: { contains: uuid },
              OR: [
                { release: { tenantId: { in: accessibleIds } } },
                { release: { ownerId: { in: accessibleIds } } },
                { tracks: { some: { release: { tenantId: { in: accessibleIds } } } } },
                { tracks: { some: { release: { ownerId: { in: accessibleIds } } } } },
                { tracksCanvas: { some: { release: { tenantId: { in: accessibleIds } } } } },
                { tracksMotion: { some: { release: { tenantId: { in: accessibleIds } } } } },
                // Edge case: Artists can see their own tracks even if they don't own the release
                ...(session.roles.includes("artist") ? [
                  { tracks: { some: { release: { artist: { name: session.entityName } } } } },
                  { release: { artist: { name: session.entityName } } }
                ] : [])
              ]
            },
            select: { id: true }
          });

          if (!asset) {
            console.warn(`[StreamSign] IDOR blocked: User ${session.id} tried to sign unowned asset ${uuid}`);
            return new Response(JSON.stringify({ error: "ERROR_ACCESS_DENIED" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }
        } else {
          // If no UUID is found, we fall back to a strict path match check
          // Assuming non-UUID paths are structured like "labelId/isrc/filename.wav"
          const assetByUrl = await prisma.asset.findFirst({
            where: {
              fileUrl: { endsWith: path.replace(/\/hls\/.*$/, "") },
              OR: [
                { release: { tenantId: { in: accessibleIds } } },
                { release: { ownerId: { in: accessibleIds } } },
                { tracks: { some: { release: { tenantId: { in: accessibleIds } } } } },
                { tracks: { some: { release: { ownerId: { in: accessibleIds } } } } }
              ]
            },
            select: { id: true }
          });

          if (!assetByUrl) {
            console.warn(`[StreamSign] IDOR blocked: User ${session.id} tried to sign unowned path ${path}`);
            return new Response(JSON.stringify({ error: "ERROR_ACCESS_DENIED" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      }
    }

    const uploadServer = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
    const apiKey = process.env.UPLOAD_API_KEY;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    // Forward the client's real IP for IP-binding in the signed token
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    headers["x-forwarded-for"] = clientIp;

    const response = await fetch(`${uploadServer}/stream/sign`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[StreamSign] Proxy error:", error);
    return new Response(
      JSON.stringify({ error: "ERROR_STREAM_SIGN_FAILED" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
