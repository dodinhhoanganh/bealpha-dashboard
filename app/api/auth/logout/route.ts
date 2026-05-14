import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "bealpha-dev-only-secret-key",
);

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("bealpha_token")?.value;

    if (token) {
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        if (payload?.jti) {
          await prisma.authToken.updateMany({
            where: { tokenHash: payload.jti as string },
            data: { isValid: false },
          });
        }
      } catch (e) {
        // Token might be expired or invalid, ignore
      }
    }

    await clearSession();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "ERROR_AN_ERROR_OCCURRED" }, { status: 500 });
  }
}
