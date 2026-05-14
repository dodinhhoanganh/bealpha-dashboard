/**
 * Health Check API
 *
 * GET /api/health — Returns system health status
 * Used by Docker healthcheck, load balancers, and monitoring.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const start = Date.now();

  try {
    const db = await checkDatabaseHealth();

    // Basic health response for unauthenticated monitoring (load balancers, Docker)
    const basicHealth = {
      status: db.connected ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
    };

    // Only expose detailed system info if an admin token or internal header is present
    const isInternal =
      request.headers.get("x-internal-health") === process.env.HEALTH_SECRET;
    if (!isInternal) {
      return NextResponse.json(basicHealth, {
        status: db.connected ? 200 : 503,
      });
    }

    // Detailed health for internal/admin monitoring
    const detailedHealth = {
      ...basicHealth,
      version: process.env.npm_package_version || "0.1.0",
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      services: {
        database: {
          status: db.connected ? "up" : "down",
          latencyMs: db.latencyMs,
          pool: {
            total: db.poolSize,
            idle: db.idleCount,
            waiting: db.waitingCount,
          },
        },
        uploadServer: {
          url: process.env.UPLOAD_SERVER_URL || "http://localhost:3001",
          status: "unknown",
        },
      },
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        unit: "MB",
      },
    };

    return NextResponse.json(detailedHealth, {
      status: db.connected ? 200 : 503,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        responseTimeMs: Date.now() - start,
      },
      { status: 503 },
    );
  }
}
