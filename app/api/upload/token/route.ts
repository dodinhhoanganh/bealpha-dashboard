import { NextResponse } from "next/server";
import { getSession, getSecureSession, hasPermission, PERMISSIONS } from "@/lib/auth";
import { SignJWT } from "jose";

/**
 * POST /api/upload/token
 * Issues a short-lived signed upload token for browser→upload-server auth.
 * The token is an HMAC-signed JWT containing userId + expiry.
 * Upload server verifies it using the shared UPLOAD_API_KEY secret.
 */

// Security audit S5: Aligned with centralized getUploadApiKey() pattern.
// In production, missing UPLOAD_API_KEY causes a fatal error at module load.
const uploadApiKey = process.env.UPLOAD_API_KEY;
if (!uploadApiKey && process.env.NODE_ENV === "production") {
  throw new Error(
    "[FATAL] UPLOAD_API_KEY is required in production for upload token signing!",
  );
}
const UPLOAD_SECRET = new TextEncoder().encode(
  uploadApiKey || "dev-upload-key-NOT-FOR-PRODUCTION",
);

export async function POST() {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    // Any authenticated user with at least RELEASE_CREATE or ARTIST_UPDATE can upload
    const canUpload =
      hasPermission(session, PERMISSIONS.RELEASE_CREATE) ||
      hasPermission(session, PERMISSIONS.ARTIST_UPDATE) ||
      hasPermission(session, PERMISSIONS.LABEL_UPDATE);

    if (!canUpload) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // Issue token valid for 10 minutes
    const token = await new SignJWT({
      sub: session.id,
      purpose: "upload",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(UPLOAD_SECRET);

    return NextResponse.json({ token, expiresIn: 600 });
  } catch (error) {
    console.error("Upload token error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_GENERATE_UPLOAD_TOKEN" },
      { status: 500 },
    );
  }
}
