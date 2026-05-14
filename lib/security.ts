/**
 * Security Engine — Risk-Based Authentication
 *
 * Implements:
 *  - Haversine formula for geo-velocity / impossible travel detection
 *  - Weighted risk scoring algorithm (0-100)
 *  - Decision engine (allow / step_up / block)
 *  - In-memory last-login cache for O(1) Haversine lookup (Fix #6)
 *
 * Based on: "Advanced Methodologies in Anomalous Login Detection
 *            and Risk-Based Authentication" research document.
 */

import { cache } from "./cache";

// ── RBA Last-Login Cache (Fix #6) ────────────────────────
// Cache last-login geo data per user for O(1) Haversine lookup.
// Avoids querying PostgreSQL LoginAuditLog on every login.
// TTL = 30 days. Falls back to DB if cache miss.

export interface LastLoginGeo {
  lat: number;
  lon: number;
  timestamp: Date;
  deviceHash?: string;
}

/**
 * Get cached last-login geo for a user. O(1) vs O(n) DB query.
 */
export function getCachedLastLogin(userId: string): LastLoginGeo | undefined {
  const raw = cache.get<LastLoginGeo & { timestamp: string }>(`rba:lastlogin:${userId}`);
  if (!raw) return undefined;
  return { ...raw, timestamp: new Date(raw.timestamp) };
}

/**
 * Update cached last-login geo after successful auth.
 * Call this after every successful login to keep cache warm.
 */
export function setCachedLastLogin(userId: string, geo: LastLoginGeo): void {
  cache.set(`rba:lastlogin:${userId}`, geo, 30 * 24 * 3600); // 30 days
}

// ── Haversine Distance (km) ──────────────────────────────

/**
 * Calculate great-circle distance between two points using Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's mean radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ── Impossible Travel Detection ──────────────────────────

export interface ImpossibleTravelResult {
  impossible: boolean;
  velocity: number; // km/h
  distance: number; // km
  timeDeltaHours: number;
}

/**
 * Detect impossible travel between two sequential login events.
 *
 * Rules (from research doc):
 *  - Velocity > 1000 km/h → impossible (faster than commercial aviation)
 *  - Distance < 100 km → suppress (minor IP geolocation inaccuracy)
 *  - Time delta < 30 seconds → suppress (network handoff artifact)
 */
export function checkImpossibleTravel(
  currentLat: number,
  currentLon: number,
  currentTime: Date,
  lastLat: number,
  lastLon: number,
  lastTime: Date,
): ImpossibleTravelResult {
  const distance = haversineDistance(lastLat, lastLon, currentLat, currentLon);
  const timeDeltaMs = currentTime.getTime() - lastTime.getTime();
  const timeDeltaHours = timeDeltaMs / (1000 * 60 * 60);

  // Temporal buffer: ignore events within 30 seconds (network handoff)
  if (timeDeltaMs < 30 * 1000) {
    return { impossible: false, velocity: 0, distance, timeDeltaHours };
  }

  // Distance threshold: ignore < 100km (IP geolocation inaccuracy)
  if (distance < 100) {
    return { impossible: false, velocity: 0, distance, timeDeltaHours };
  }

  const velocity = timeDeltaHours > 0 ? distance / timeDeltaHours : Infinity;

  // Velocity > 1000 km/h = faster than commercial aviation
  const impossible = velocity > 1000;

  return { impossible, velocity: Math.round(velocity), distance: Math.round(distance), timeDeltaHours };
}

// ── Risk Score Factors ───────────────────────────────────

export interface RiskFactors {
  isKnownDevice: boolean; // hardwareId seen within 30d
  isKnownIP: boolean; // IP seen within 30d
  isKnownLocation: boolean; // Same city/country within 30d
  impossibleTravel: boolean; // Haversine velocity > 1000 km/h
  timeSinceLastLoginDays: number; // Days since last login
  deviceFingerprintMatch: boolean; // Device fingerprint hash match
}

/**
 * Weighted risk scoring algorithm.
 *
 * Weight table:
 *  - Unknown device:      +25
 *  - Unknown IP:          +15
 *  - Unknown location:    +10
 *  - Impossible travel:   +30
 *  - Long inactivity:     +5 (>30 days)
 *  - No device match:     +15
 *
 * Score range: 0-100
 */
export function calculateRiskScore(factors: RiskFactors): number {
  let score = 0;

  if (!factors.isKnownDevice) score += 25;
  if (!factors.isKnownIP) score += 15;
  if (!factors.isKnownLocation) score += 10;
  if (factors.impossibleTravel) score += 30;
  if (factors.timeSinceLastLoginDays > 30) score += 5;
  if (!factors.deviceFingerprintMatch) score += 15;

  return Math.min(score, 100);
}

// ── Decision Engine ──────────────────────────────────────

export type RiskDecision = "allow" | "step_up" | "block";

/**
 * Map risk score to adaptive authentication decision.
 *
 *  0-30  → allow   (trusted context, no friction)
 *  31-70 → step_up (force 2FA / verify email)
 *  71-100 → block  (deny access, lock account, alert user)
 */
export function getRiskDecision(score: number): RiskDecision {
  if (score <= 30) return "allow";
  if (score <= 70) return "step_up";
  return "block";
}

/**
 * Classify the login type based on risk factors.
 */
export function classifyLoginType(factors: RiskFactors): string {
  if (factors.impossibleTravel) return "impossible_travel";
  if (!factors.isKnownDevice && !factors.isKnownIP) return "new_device";
  if (!factors.isKnownLocation) return "new_location";
  return "normal";
}

/**
 * Parse a user-agent string to extract a human-readable device description.
 * e.g. "Chrome 126 on Windows" or "Safari on iPhone"
 */
export function parseDeviceFromUA(ua: string): string {
  if (!ua || ua === "unknown") return "Unknown Device";

  // Extract browser
  let browser = "Unknown Browser";
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edg|OPR|Opera|Brave)\/(\d+)/);
  if (browserMatch) {
    const name = browserMatch[1] === "Edg" ? "Edge" : browserMatch[1] === "OPR" ? "Opera" : browserMatch[1];
    browser = `${name} ${browserMatch[2]}`;
  }

  // Extract OS
  let os = "";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("iPhone")) os = "iPhone";
  else if (ua.includes("iPad")) os = "iPad";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Linux")) os = "Linux";

  return os ? `${browser} on ${os}` : browser;
}
