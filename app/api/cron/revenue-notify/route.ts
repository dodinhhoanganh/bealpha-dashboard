import { NextRequest, NextResponse } from "next/server";
import { NotificationService } from "@/lib/services/notification.service";
import { timingSafeEqual } from "crypto";

/**
 * GET /api/cron/revenue-notify
 * Triggered by an external crontab to generate quarterly revenue notifications.
 * Secured using CRON_SECRET bearer token.
 */
export async function GET(request: NextRequest) {
  try {
    // B13 fix: reject all if CRON_SECRET not configured (fail-closed)
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error(
        "[CRON] CRON_SECRET is not configured — rejecting all requests",
      );
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const authHeader = request.headers.get("authorization");
    const provided = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";
    if (
      !provided ||
      provided.length !== cronSecret.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(cronSecret))
    ) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    // Determine the previous quarter name based on current date
    const now = new Date();
    const month = now.getMonth(); // 0-11
    let quarter = "";
    let year = now.getFullYear();

    if (month >= 0 && month <= 2) {
      quarter = "Q4";
      year -= 1;
    } else if (month >= 3 && month <= 5) {
      quarter = "Q1";
    } else if (month >= 6 && month <= 8) {
      quarter = "Q2";
    } else {
      quarter = "Q3";
    }

    const quarterName = `${quarter} ${year}`;

    await NotificationService.notifyQuarterlyRevenue(quarterName);

    return NextResponse.json({
      success: true,
      message: `Triggered revenue notifications for ${quarterName}`,
    });
  } catch (error) {
    console.error("Cron Revenue Notify Error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_TRIGGER_REVENUE_NOTIFICATIONS" },
      { status: 500 },
    );
  }
}
