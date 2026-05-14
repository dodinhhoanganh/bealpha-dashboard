import { NextRequest } from "next/server";
import { getSecureSession } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    // B7 fix: Require authenticated session before proxying
    const session = await getSecureSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "ERROR_NOT_AUTHENTICATED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { path } = await params;
    const targetPath = path.join("/");

    // Security: Strict path traversal prevention
    if (/(^|\/)\.\.(\/|$)/.test(targetPath)) {
      return new Response(JSON.stringify({ error: "ERROR_INVALID_PATH" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    // B4 fix: Use env variable instead of hardcoded localhost
    const uploadServer = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
    const targetUrl = `${uploadServer}/upload/${targetPath}${url.search}`;

    const headers = new Headers();
    // Copy only essential headers to avoid Next.js/fetch conflicts
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    // B5 fix: Always forward API key for server-to-server auth
    const apiKey = process.env.UPLOAD_API_KEY;
    if (apiKey) headers.set("x-api-key", apiKey);

    // Forward upload token if present
    const uploadToken = req.headers.get("x-upload-token");
    if (uploadToken) headers.set("x-upload-token", uploadToken);

    // Forward the auth cookie if needed
    const cookie = req.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: req.body as any,
      // @ts-ignore
      duplex: "half",
    });

    // Convert to array buffer to avoid streaming issues back to the client
    const arrayBuffer = await response.arrayBuffer();

    return new Response(arrayBuffer, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("Proxy upload error:", error);
    // B6 fix: Never leak internal error details to client
    return new Response(
      JSON.stringify({
        error: "ERROR_UPLOAD_FAILED_PLEASE_TRY_AGAIN",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
