/**
 * Rate Limiter
 *
 * In-memory sliding window rate limiter for API routes.
 * For multi-instance deployments, swap to Redis-based limiter.
 *
 * Usage:
 *   import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
 *
 *   export async function POST(request: NextRequest) {
 *     const limited = rateLimit(request, RATE_LIMITS.WRITE);
 *     if (limited) return limited;
 *     // ... handler logic
 *   }
 */

import { NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string; // Custom error message
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ── Pre-defined rate limit profiles ──────────────────────
// Security audit fix H3: Tightened all limits to production-safe values.
// Auth endpoints now have dedicated rate limiting to prevent brute-force.
export const RATE_LIMITS = {
  /** Standard API reads: 300 req / min */
  API: {
    windowMs: 60 * 1000,
    maxRequests: 300,
  },
  /** Data write operations (create/update/delete): 60 req / min */
  WRITE: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
  /** Authentication endpoints (login, 2FA, password reset): 10 req / min */
  AUTH: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: "Too many authentication attempts. Please wait before trying again.",
  },
  /** File uploads: 100 req / min */
  UPLOAD: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    message: "Upload rate limit exceeded. Please wait.",
  },
  /** DDEX delivery / export: 50 req / min */
  DDEX: {
    windowMs: 60 * 1000,
    maxRequests: 50,
    message: "Distribution rate limit exceeded.",
  },
} as const;

// ── In-memory store ──────────────────────────────────────
const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) store.delete(key);
      }
    },
    5 * 60 * 1000,
  );
}

/**
 * Get client identifier from request
 */
function getClientId(request: NextRequest): string {
  // Try X-Forwarded-For (behind proxy/load balancer)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  // Try X-Real-IP
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  // Fallback
  return "unknown";
}

/**
 * Apply rate limiting to a request.
 * Returns null if allowed, or a 429 Response if rate limited.
 */
export function rateLimit(
  request: NextRequest,
  config: RateLimitConfig = RATE_LIMITS.API,
): NextResponse | null {
  const clientId = getClientId(request);
  const key = `${clientId}:${new URL(request.url).pathname}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      {
        error: config.message || "Rate limit exceeded",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(config.maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      },
    );
  }

  return null;
}
