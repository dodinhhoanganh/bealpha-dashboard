import { NextRequest, NextResponse } from "next/server";
import { getSecureSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// Allow previous + current + next TOTP code (window=1)
authenticator.options = { window: 1 };

// Helper: parse comma-separated methods string to array
function parseMethods(method: string | null): string[] {
  if (!method) return [];
  return method
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

// Helper: array to comma-separated string
function serializeMethods(methods: string[]): string | null {
  const unique = [...new Set(methods.filter(Boolean))];
  return unique.length > 0 ? unique.join(",") : null;
}

// GET: Get current 2FA status
export async function GET() {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: {
        twoFactorEnabled: true,
        twoFactorMethod: true,
        phone: true,
        email: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    const methods = parseMethods(user.twoFactorMethod);

    return NextResponse.json({
      enabled: user.twoFactorEnabled,
      methods, // array e.g. ["email", "app"]
      hasApp: methods.includes("app"),
      hasPhone: !!user.phone,
      email: user.email,
    });
  } catch (error) {
    console.error("Get 2FA status error:", error);
    return NextResponse.json({ error: "ERROR_SERVER_ERROR" }, { status: 500 });
  }
}

// POST: Setup or update 2FA
export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const body = await request.json();
    const action = typeof body.action === "string" ? body.action : undefined;
    const method = typeof body.method === "string" ? body.method : undefined;
    const phone = typeof body.phone === "string" ? body.phone : undefined;
    const code = typeof body.code === "string" ? body.code : undefined;

    const user = await prisma.user.findUnique({
      where: { id: session.id },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    const currentMethods = parseMethods(user.twoFactorMethod);

    // Generate TOTP secret and QR code for authenticator app
    if (action === "setup-app") {
      const secret = authenticator.generateSecret();
      const otpauth = authenticator.keyuri(user.email, "beAlpha", secret);
      const qrCodeUrl = await QRCode.toDataURL(otpauth);

      // D1 fix: Sign the secret into a short-lived JWT instead of returning raw
      // This prevents client-side injection of attacker-controlled secrets
      const { SignJWT } = await import("jose");
      const PENDING_SECRET = new TextEncoder().encode(
        process.env.JWT_SECRET || "bealpha-dev-only-secret-key",
      );
      const pendingSecretToken = await new SignJWT({
        secret,
        userId: user.id,
        purpose: "totp-setup",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(PENDING_SECRET);

      return NextResponse.json({ pendingSecretToken, qrCodeUrl });
    }

    // Verify and enable authenticator app (add to methods)
    if (action === "verify-app") {
      // D1 fix: Only accept secret from signed pendingSecretToken, never from body
      const pendingSecretToken = typeof body.pendingSecretToken === "string" ? body.pendingSecretToken : undefined;
      if (!pendingSecretToken) {
        return NextResponse.json(
          { error: "ERROR_SETUP_TOKEN_REQUIRED_PLEASE_START_SETUP_AGAI" },
          { status: 400 },
        );
      }

      let secretToVerify: string;
      try {
        const { jwtVerify } = await import("jose");
        const PENDING_SECRET = new TextEncoder().encode(
          process.env.JWT_SECRET || "bealpha-dev-only-secret-key",
        );
        const { payload } = await jwtVerify(pendingSecretToken, PENDING_SECRET);
        if (payload.purpose !== "totp-setup" || payload.userId !== user.id) {
          throw new Error("Invalid setup token");
        }
        secretToVerify = payload.secret as string;
      } catch {
        return NextResponse.json(
          { error: "ERROR_SETUP_SESSION_EXPIRED_PLEASE_START_SETUP_AGA" },
          { status: 401 },
        );
      }

      if (!code || code.length > 20) {
        return NextResponse.json(
          { error: "ERROR_VERIFICATION_CODE_IS_REQUIRED_AND_MUST_BE_VA" },
          { status: 400 },
        );
      }

      const isValid = authenticator.verify({
        token: code,
        secret: secretToVerify,
      });

      if (!isValid) {
        return NextResponse.json(
          { error: "ERROR_INVALID_VERIFICATION_CODE" },
          { status: 400 },
        );
      }

      const newMethods = [...currentMethods.filter((m) => m !== "app"), "app"];

      // Generate 10 recovery codes

      const plaintextCodes: string[] = [];
      const hashedCodes: string[] = [];

      for (let i = 0; i < 10; i++) {
        const buf = randomBytes(4);
        const code = buf.toString("hex").toUpperCase();
        const formattedCode = `${code.substring(0, 4)}-${code.substring(4)}`;
        plaintextCodes.push(formattedCode);
        const hash = await bcrypt.hash(formattedCode, 10);
        hashedCodes.push(hash);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: secretToVerify,
          twoFactorEnabled: true,
          twoFactorMethod: serializeMethods(newMethods),
          twoFactorRecoveryCodes: hashedCodes,
        },
      });

      return NextResponse.json({
        success: true,
        methods: newMethods,
        recoveryCodes: plaintextCodes,
      });
    }

    // Enable email 2FA (add to methods)
    if (action === "enable-email") {
      const newMethods = [
        ...currentMethods.filter((m) => m !== "email"),
        "email",
      ];
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorMethod: serializeMethods(newMethods),
        },
      });

      return NextResponse.json({ success: true, methods: newMethods });
    }

    // Disable a specific method
    if (action === "disable-method" && method) {
      const password = typeof body.password === "string" ? body.password : undefined;
      if (!password) {
        return NextResponse.json(
          { error: "ERROR_PASSWORD_REQUIRED_TO_DISABLE_A_2FA_METHOD" },
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
        twoFactorMethod: serializeMethods(newMethods),
        twoFactorEnabled: newMethods.length > 0,
      };

      // If disabling app, also clear secret
      if (method === "app") {
        updateData.twoFactorSecret = null;
      }

      // If no methods left, fully disable
      if (newMethods.length === 0) {
        updateData.twoFactorMethod = null;
        updateData.twoFactorSecret = null;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });

      return NextResponse.json({ success: true, methods: newMethods });
    }

    // Disable ALL 2FA (H3 fix: require password re-verification)
    if (action === "disable") {
      const password = typeof body.password === "string" ? body.password : undefined;
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

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorMethod: null,
          twoFactorSecret: null,
        },
      });

      // Clean up pending codes
      await prisma.twoFactorCode.deleteMany({
        where: { userId: user.id, used: false },
      });

      // M5 fix: Notify user that 2FA was disabled
      try {
        const { sendSecurityAlert } = await import("@/lib/email");
        await sendSecurityAlert(user.email, {
          userAgent: "Settings",
          ipAddress: "Self-action",
          timestamp: new Date(),
          reason: "Two-Factor Authentication Disabled",
        });
      } catch (e) {
        console.error("2FA disable alert email failed:", e);
      }

      return NextResponse.json({ success: true, methods: [] });
    }

    return NextResponse.json({ error: "ERROR_INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    console.error("2FA setup error:", error);
    return NextResponse.json({ error: "ERROR_SERVER_ERROR" }, { status: 500 });
  }
}
