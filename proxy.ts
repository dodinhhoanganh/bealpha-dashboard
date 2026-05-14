/**
 * Next.js 16 Proxy (replaces middleware.ts)
 *
 * Runs on every matched request before route handlers.
 * Handles: Security headers, CORS, auth redirects, rate limiting.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyTokenEdge } from "@/lib/auth-edge";

// ── Security Headers ─────────────────────────────────────
const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  ...(process.env.NODE_ENV === "production"
    ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload" }
    : {}),
  "Content-Security-Policy": (() => {
    const uploadUrl = process.env.NEXT_PUBLIC_UPLOAD_URL || "";
    const isProd = process.env.NODE_ENV === "production";
    // Security audit S3: Removed 'unsafe-eval' — XSS via eval() is a critical attack vector.
    // Next.js production builds do NOT require unsafe-eval.
    const devSources = isProd ? "" : " http://localhost:* http://127.0.0.1:*";
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${uploadUrl} https:${devSources}`,
      "font-src 'self' data:",
      `connect-src 'self' ${uploadUrl} blob: https://api.spotify.com https://api.music.apple.com ws: wss:${devSources}`,
      `media-src 'self' ${uploadUrl} blob:${devSources}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
  })(),
};

// ── Auth-Protected Paths ─────────────────────────────────
// Closed-by-default: ALL pages require auth EXCEPT these public ones
const PUBLIC_PAGES = ["/login", "/invite"];
const PUBLIC_API_ROUTES = [
  "/api/auth/login",
  "/api/auth/2fa/send",
  "/api/auth/2fa/verify",
  "/api/health",
  "/api/cron/release-scheduler",
  "/api/invitations/accept",
];

// ── CORS Origins ─────────────────────────────────────────
const ALLOWED_ORIGINS = new Set(
  [
    "http://localhost:3000",
    "http://localhost:3001",
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.CORS_ORIGIN,
  ].filter(Boolean)
);

function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With";
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

// ── Rate Limiting (edge-compatible, in-memory) ───────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

function edgeRateLimit(ip: string, path: string, max: number, windowMs: number): boolean {
  const key = `${ip}:${path}`;
  const now = Date.now();

  // Periodic cleanup: remove expired entries every 60s to prevent memory leak
  if (now - lastCleanup > 60_000) {
    lastCleanup = now;
    for (const [k, v] of rateLimitStore) {
      if (now > v.resetAt) rateLimitStore.delete(k);
    }
  }

  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > max;
}

// ── Proxy Handler ────────────────────────────────────────
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: { ...getCorsHeaders(origin), ...securityHeaders },
    });
  }

  // Allow public paths without auth
  const isPublicApi = PUBLIC_API_ROUTES.some((r) => pathname.startsWith(r));

  // Rate limit data-modifying operations (POST/PUT/PATCH/DELETE) on non-auth API routes
  // Security audit S7: Tightened from 3000 to 60 req/min to match Sprint 1 rate limits
  const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  const isDataApi = pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/");
  const isDdexBatch = pathname.startsWith("/api/releases/import") || pathname.startsWith("/api/releases/export");
  if (isWriteMethod && isDataApi && !isDdexBatch) {
    if (edgeRateLimit(ip, "/api/data-write", 60, 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": "60", ...securityHeaders } }
      );
    }
  }

  // Rate limit auth endpoints — strict limits to prevent brute force
  const authRateLimitPaths = ["/api/auth/login", "/api/auth/2fa/verify", "/api/auth/2fa/send", "/api/auth/change-password"];
  const isAuthEndpoint = authRateLimitPaths.some(p => pathname.startsWith(p));
  if (isAuthEndpoint && request.method === "POST") {
    // Stricter limit for login & 2FA: 5 attempts per minute per IP
    const maxAttempts = pathname.includes("/2fa/") ? 5 : 5;
    if (edgeRateLimit(ip, pathname, maxAttempts, 60 * 1000)) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": "60", ...securityHeaders } }
      );
    }
  }

  // Auth check for pages — closed-by-default (all pages require auth except PUBLIC_PAGES)
  const isPage = !pathname.startsWith("/api/");
  const isPublicPage = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  
  // Auth check for API routes — verify token exists for non-public APIs
  const isApi = pathname.startsWith("/api/");
  if (isApi && !isPublicApi) {
    const token = request.cookies.get("bealpha_token")?.value;
    if (!token) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401, headers: securityHeaders }
      );
    }
    const user = await verifyTokenEdge(token);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401, headers: securityHeaders }
      );
    }
    // Forward user info in headers for API routes too
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", user.id);
    requestHeaders.set("x-user-email", user.email);
    requestHeaders.set("x-user-roles", (user.roles || []).join(","));
    // SEC-6 fix: Forward B2B2B entity context (matches middleware.ts behavior)
    if (user.entityType) requestHeaders.set("x-entity-type", user.entityType);
    if (user.entityId) requestHeaders.set("x-entity-id", user.entityId);
    if (user.entityPath) requestHeaders.set("x-entity-path", user.entityPath);
    if (user.entityName) requestHeaders.set("x-entity-name", user.entityName);
    if (user.tenantId) requestHeaders.set("x-tenant-id", user.tenantId);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const [key, value] of Object.entries(securityHeaders)) {
      response.headers.set(key, value);
    }
    for (const [key, value] of Object.entries(getCorsHeaders(origin))) {
      response.headers.set(key, value);
    }
    return response;
  }

  if (
    isPage &&
    !isPublicPage &&
    !isPublicApi
  ) {
    const token = request.cookies.get("bealpha_token")?.value;
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      // Security audit S2: Prevent open redirect — only allow relative paths
      if (pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.includes(":")) {
        loginUrl.searchParams.set("redirect", pathname);
      }
      return NextResponse.redirect(loginUrl);
    }
    const user = await verifyTokenEdge(token);
    if (!user) {
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("bealpha_token");
      return response;
    }

    // Forward user info in headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", user.id);
    requestHeaders.set("x-user-email", user.email);
    requestHeaders.set("x-user-roles", (user.roles || []).join(","));

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const [key, value] of Object.entries(securityHeaders)) {
      response.headers.set(key, value);
    }
    for (const [key, value] of Object.entries(getCorsHeaders(origin))) {
      response.headers.set(key, value);
    }
    return response;
  }

  // For all other routes — apply security headers
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }
  for (const [key, value] of Object.entries(getCorsHeaders(origin))) {
    response.headers.set(key, value);
  }
  return response;
}

// ── Matcher ──────────────────────────────────────────────
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/proxy_upload/.*|upload/.*|stream/.*|uploads/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
