import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getSecureSession, hasPermission, PERMISSIONS, isAdmin } from "@/lib/auth";
import { canAccessRelease } from "@/app/api/releases/[id]/route";
import {
  sendDelivery,
  retryDelivery,
  confirmDelivery,
} from "@/lib/ddex/delivery";

/**
 * GET /api/ddex/deliveries/[id]
 * Get single delivery details including XML content
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    const delivery = await prisma.ddexDelivery.findUnique({
      where: { id },
      include: {
        release: {
          select: {
            id: true,
            title: true,
            ean: true,
            status: true,
            coverUrl: true,
            artistId: true,
            labelId: true,
            artist: { select: { id: true, name: true } },
            label: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!delivery) {
      return NextResponse.json(
        { error: "ERROR_DELIVERY_NOT_FOUND" },
        { status: 404 },
      );
    }

    const hasAccess = await canAccessRelease(session, delivery.release.id);
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    return NextResponse.json(delivery);
  } catch (error) {
    console.error("Get delivery error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_DELIVERY" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/ddex/deliveries/[id]
 * Update delivery status: send, retry, confirm
 *
 * Body: { action: "send" | "retry" | "confirm" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.RELEASE_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    if (!["send", "retry", "confirm"].includes(action)) {
      return NextResponse.json(
        { error: "ERROR_INVALID_ACTION" },
        { status: 400 },
      );
    }

    // Verify delivery exists
    const delivery = await prisma.ddexDelivery.findUnique({
      where: { id },
      include: {
        release: { select: { id: true, artistId: true, labelId: true } },
      },
    });

    if (!delivery) {
      return NextResponse.json(
        { error: "ERROR_DELIVERY_NOT_FOUND" },
        { status: 404 },
      );
    }

    const hasAccess = await canAccessRelease(session, delivery.release.id);
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    let result: { success: boolean; error?: string };

    switch (action) {
      case "send":
        result = await sendDelivery(id);
        break;
      case "retry":
        result = await retryDelivery(id);
        break;
      case "confirm":
        const confirmed = await confirmDelivery(id);
        result = {
          success: confirmed,
          error: confirmed ? undefined : "Failed to confirm",
        };
        break;
      default:
        result = { success: false, error: "ERROR_UNKNOWN_ACTION" };
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Return updated delivery
    const updated = await prisma.ddexDelivery.findUnique({
      where: { id },
      include: {
        release: {
          select: {
            id: true,
            title: true,
            ean: true,
            status: true,
            artist: { select: { id: true, name: true } },
            label: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Strip xmlContent from response
    if (updated) {
      const { xmlContent, ...data } = updated;
      return NextResponse.json(data);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update delivery error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_UPDATE_DELIVERY" },
      { status: 500 },
    );
  }
}
