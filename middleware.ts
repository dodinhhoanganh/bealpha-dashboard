/**
 * Next.js Edge Middleware — Route-level Authentication & Authorization
 *
 * Security audit fix C2:
 *  - Enforces authentication on all /dashboard routes
 *  - Restricts admin-only routes from SUB_ACCOUNT entities
 *  - Redirects unauthenticated users to /login
 *  - Uses edge-compatible JWT verification (no Prisma/Node.js APIs)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyTokenEdge } from "@/lib/auth-edge";

// Routes accessible without session cookie authentication.
// These use their own auth: cron uses bearer token, 2FA uses temp token, etc.
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/2fa",         // 2FA endpoints use temp token, not session
  "/api/health",
  "/api/cron",             // S6: Uses CRON_SECRET bearer token auth
  "/api/invitations/accept",
];

// Routes restricted from SUB_ACCOUNT entities
const ADMIN_ONLY_PATHS = [
  "/dashboard/entities",
  "/dashboard/team-members",
  "/dashboard/system",
  "/dashboard/audit-log",
  "/dashboard/roles",
];

// Routes restricted to SYSTEM_ADMIN / SUPER_ADMIN only
const SYSTEM_ADMIN_PATHS = [
  "/dashboard/system",
  "/dashboard/audit-log",
];

const COOKIE_NAME = "bealpha_token";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets, _next, and favicon
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/static") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg")
  ) {
    return NextResponse.next();
  }

  // Check authentication for dashboard and API routes
  const token = req.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    // API routes return 401, page routes redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "ERROR_NOT_AUTHENTICATED" },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    // Security audit S2: Prevent open redirect — only allow relative paths
    if (pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.includes(":")) {
      loginUrl.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Verify JWT (edge-compatible, no DB call)
  const user = await verifyTokenEdge(token);

  if (!user) {
    // Invalid/expired token
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "ERROR_SESSION_EXPIRED" },
        { status: 401 },
      );
    }
    const response = NextResponse.redirect(new URL("/login", req.url));
    // Clear invalid cookie
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  // Entity-type based route restrictions
  if (pathname.startsWith("/dashboard")) {
    // SUB_ACCOUNT cannot access admin management pages
    if (
      user.entityType === "SUB_ACCOUNT" &&
      ADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p))
    ) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // System-level routes restricted to SYSTEM_ADMIN / SUPER_ADMIN
    if (
      SYSTEM_ADMIN_PATHS.some((p) => pathname.startsWith(p)) &&
      user.entityType !== "SYSTEM_ADMIN" &&
      user.entityType !== "SUPER_ADMIN"
    ) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Attach user info to headers for downstream API routes
  const response = NextResponse.next();
  response.headers.set("x-user-id", user.id);
  response.headers.set("x-user-email", user.email);
  if (user.entityType) {
    response.headers.set("x-entity-type", user.entityType);
  }

  return response;
}

export const config = {
  matcher: [
    // Match all dashboard pages and API routes except public paths
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
