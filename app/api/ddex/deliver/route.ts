import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getSecureSession, hasPermission, PERMISSIONS, isSystemAdmin } from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import { createDeliveries, sendDelivery, DSP_LIST } from "@/lib/ddex/delivery";

/**
 * POST /api/ddex/deliver
 * Initiate delivery of a release to selected DSPs
 *
 * Body: { releaseId, dspIds: string[], messageType?: "NewRelease" | "Update" | "Takedown", autoSend?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.RELEASE_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    const {
      releaseId,
      dspIds,
      messageType = "NewRelease",
      autoSend = false,
    } = body;

    if (!releaseId) {
      return NextResponse.json(
        { error: "ERROR_RELEASEID_IS_REQUIRED" },
        { status: 400 },
      );
    }
    if (!dspIds || !Array.isArray(dspIds) || dspIds.length === 0) {
      return NextResponse.json(
        { error: "ERROR_DSPIDS_ARRAY_IS_REQUIRED" },
        { status: 400 },
      );
    }

    // B2B2B: Check release belongs to user's tenant
    if (!isSystemAdmin(session)) {
      const release = await prisma.release.findUnique({
        where: { id: releaseId },
        select: { tenantId: true },
      });
      if (!release) {
        return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
      }
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(release.tenantId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    // Validate DSP IDs
    const validDspIds: string[] = DSP_LIST.map((d) => d.id);
    const invalidDsps = dspIds.filter(
      (id: string) => !validDspIds.includes(id),
    );
    if (invalidDsps.length > 0) {
      return NextResponse.json(
        { error: `Invalid DSP IDs: ${invalidDsps.join(", ")}` },
        { status: 400 },
      );
    }

    // Create delivery records + generate XML
    const { deliveries, errors } = await createDeliveries(
      releaseId,
      dspIds,
      messageType,
    );

    // Optionally auto-send all created deliveries
    if (autoSend && deliveries.length > 0) {
      const sendResults = await Promise.all(
        deliveries.map((d) => sendDelivery(d.id)),
      );
      const sendErrors = sendResults
        .filter((r) => !r.success)
        .map((r) => r.error!);
      errors.push(...sendErrors);
    }

    return NextResponse.json({
      deliveries: deliveries.map((d) => ({
        id: d.id,
        dspName: d.dspName,
        status: autoSend ? "sent" : d.status,
        batchId: d.batchId,
        messageType: d.messageType,
        release: d.release,
      })),
      errors,
      batchId: deliveries[0]?.batchId || null,
    });
  } catch (error) {
    console.error("Delivery error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_INITIATE_DELIVERY" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ddex/deliver
 * List available DSPs
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    return NextResponse.json({ dsps: DSP_LIST });
  } catch (error) {
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_DSP_LIST" },
      { status: 500 },
    );
  }
}
