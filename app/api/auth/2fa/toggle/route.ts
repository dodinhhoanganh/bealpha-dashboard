import { NextRequest, NextResponse } from "next/server";
import { getSecureSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Helper: parse comma-separated methods string to array
function parseMethods(method: string | null): string[] {
  if (!method) return [];
  return method
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function serializeMethods(methods: string[]): string | null {
  const unique = [...new Set(methods.filter(Boolean))];
  return unique.length > 0 ? unique.join(",") : null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await request.json();
    const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
    const method = typeof body.method === "string" ? body.method : undefined;
    const password = typeof body.password === "string" ? body.password : undefined;

    if (enabled === undefined || method === undefined) {
      return NextResponse.json(
        { error: "ERROR_MISSING_OR_INVALID_ENABLED_METHOD_FIELDS" },
        { status: 400 },
      );
    }

    // Validate method
    const validMethods = ["email", "app"];
    if (enabled && !validMethods.includes(method)) {
      return NextResponse.json(
        { error: "ERROR_INVALID_2FA_METHOD" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorMethod: true,
        twoFactorSecret: true,
        phone: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    const currentMethods = parseMethods(user.twoFactorMethod);

    // === Enabling a specific method (add to list) ===
    if (enabled) {
      if (method === "app" && !user.twoFactorSecret) {
        return NextResponse.json(
          { error: "ERROR_PLEASE_SET_UP_YOUR_AUTHENTICATOR_APP_FIRST" },
          { status: 400 },
        );
      }

      const newMethods = [
        ...currentMethods.filter((m) => m !== method),
        method,
      ];

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorMethod: serializeMethods(newMethods),
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        methods: newMethods,
        message: "Two-factor authentication method enabled",
      });
    }

    // === Disabling a specific method (remove from list) ===
    if (!password) {
      return NextResponse.json(
        { error: "ERROR_PASSWORD_REQUIRED_TO_DISABLE_2FA" },
        { status: 400 },
      );
    }

    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      return NextResponse.json(
        { error: "ERROR_INCORRECT_PASSWORD" },
        { status: 401 },
      );
    }

    const newMethods = currentMethods.filter((m) => m !== method);
    const updateData: Record<string, unknown> = {
      twoFactorEnabled: newMethods.length > 0,
      twoFactorMethod: serializeMethods(newMethods),
      updatedAt: new Date(),
    };

    // If disabling app method, clear secret
    if (method === "app") {
      updateData.twoFactorSecret = null;
    }

    // If no methods left, full cleanup
    if (newMethods.length === 0) {
      updateData.twoFactorSecret = null;
      await prisma.twoFactorCode.deleteMany({
        where: { userId: user.id, used: false },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      methods: newMethods,
      message:
        newMethods.length > 0
          ? "Two-factor authentication method removed"
          : "Two-factor authentication disabled",
    });
  } catch (error) {
    console.error("Toggle 2FA error:", error);
    return NextResponse.json({ error: "ERROR_AN_ERROR_OCCURRED" }, { status: 500 });
  }
}
