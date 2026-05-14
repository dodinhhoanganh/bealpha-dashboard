import { NextRequest, NextResponse } from "next/server";
import { getSession, hasPermission, PERMISSIONS } from "@/lib/auth";
import { validateERN } from "@/lib/ddex/ern-generator";

/**
 * POST /api/ddex/validate
 * Validate DDEX ERN XML content
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    const { xml } = body;

    if (!xml || typeof xml !== "string") {
      return NextResponse.json(
        { error: "ERROR_XML_STRING_IS_REQUIRED" },
        { status: 400 },
      );
    }

    // Prevent DoS via oversized payloads
    if (xml.length > 10_000_000) {
      return NextResponse.json(
        { error: "ERROR_XML_PAYLOAD_TOO_LARGE_MAX_10MB" },
        { status: 413 },
      );
    }

    const result = validateERN(xml);

    return NextResponse.json(result);
  } catch (error) {
    console.error("ERN validation error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_VALIDATE_ERN_XML" },
      { status: 500 },
    );
  }
}
