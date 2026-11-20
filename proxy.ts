import { NextRequest, NextResponse } from "next/server";

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=(self)",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=(self)",
  "midi=()",
  "payment=()",
  "picture-in-picture=(self)",
  "publickey-credentials-get=(self)",
  "screen-wake-lock=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

function buildSecurityHeaders(nonce: string): Record<string, string> {
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  const isProd = process.env.NODE_ENV === "production";
  const devConnect = isProd ? "" : " http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*";
  const devImg = isProd ? "" : " http://localhost:* http://127.0.0.1:*";
  const devScript = isProd ? "" : " 'unsafe-eval'";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devScript}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiUrl} https://i.scdn.co https://mosaic.scdn.co https://lineup-images.scdn.co https://is1-ssl.mzstatic.com https://is2-ssl.mzstatic.com https://is3-ssl.mzstatic.com https://is4-ssl.mzstatic.com https://is5-ssl.mzstatic.com${devImg}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiUrl} blob: https://api.spotify.com https://api.music.apple.com${devConnect}`,
    `media-src 'self' ${apiUrl} blob:${devImg}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-site",
    ...(isProd
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload" }
      : {}),
    "Content-Security-Policy": csp,
  };
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const securityHeaders = buildSecurityHeaders(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", securityHeaders["Content-Security-Policy"]);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(securityHeaders)) response.headers.set(key, value);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
