import { NextRequest, NextResponse } from "next/server";
import { getSecureSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFileFromServer } from "@/lib/upload";

export async function PUT(request: NextRequest) {
  try {
    // B12 fix: use getSecureSession for stateful token check + theft detection
    const payload = await getSecureSession();
    if (!payload) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      stageName,
      phone,
      avatar,
      language,
      timezone,
      currency,
      theme,
      notifyReleases,
      notifyRoyalties,
      notifyNews,
      notifyMarketing,
    } = body;

    // ── Input validation & sanitization ──
    if (name !== undefined && typeof name === "string" && name.length > 100) {
      return NextResponse.json(
        { error: "ERROR_NAME_MUST_BE_100_CHARACTERS_OR_LESS" },
        { status: 400 },
      );
    }
    if (
      stageName !== undefined &&
      typeof stageName === "string" &&
      stageName.length > 100
    ) {
      return NextResponse.json(
        { error: "ERROR_STAGE_NAME_MUST_BE_100_CHARACTERS_OR_LESS" },
        { status: 400 },
      );
    }
    if (phone !== undefined && phone !== null && phone !== "") {
      if (typeof phone !== "string" || !/^\+?[\d\s\-()]{7,20}$/.test(phone)) {
        return NextResponse.json(
          { error: "ERROR_INVALID_PHONE_NUMBER_FORMAT" },
          { status: 400 },
        );
      }
    }
    if (avatar !== undefined && avatar !== null && avatar !== "") {
      const UPLOAD_SERVER = process.env.UPLOAD_SERVER_URL || process.env.NEXT_PUBLIC_UPLOAD_URL || "http://localhost:3001";
      if (typeof avatar !== "string") {
        return NextResponse.json(
          { error: "ERROR_AVATAR_MUST_BE_A_VALID_HTTP_HTTPS_URL_OR_INT" },
          { status: 400 },
        );
      }
      
      const isRelative = avatar.startsWith("/uploads/");
      const isUploadServer = avatar.startsWith(UPLOAD_SERVER);
      
      if (!isRelative && !isUploadServer) {
        return NextResponse.json(
          { error: "ERROR_AVATAR_MUST_BE_A_VALID_HTTP_HTTPS_URL_OR_INT" },
          { status: 400 },
        );
      }
      if (avatar.length > 2000) {
        return NextResponse.json(
          { error: "ERROR_AVATAR_URL_TOO_LONG" },
          { status: 400 },
        );
      }
    }
    if (
      language !== undefined &&
      typeof language === "string" &&
      language.length > 10
    ) {
      return NextResponse.json(
        { error: "ERROR_INVALID_LANGUAGE_CODE" },
        { status: 400 },
      );
    }
    if (
      timezone !== undefined &&
      typeof timezone === "string" &&
      timezone.length > 50
    ) {
      return NextResponse.json({ error: "ERROR_INVALID_TIMEZONE" }, { status: 400 });
    }
    if (
      currency !== undefined &&
      typeof currency === "string" &&
      currency.length > 5
    ) {
      return NextResponse.json(
        { error: "ERROR_INVALID_CURRENCY_CODE" },
        { status: 400 },
      );
    }
    if (
      theme !== undefined &&
      typeof theme === "string" &&
      !["light", "dark"].includes(theme)
    ) {
      return NextResponse.json(
        { error: "ERROR_INVALID_THEME_VALUE" },
        { status: 400 },
      );
    }

    // Strip HTML tags from string inputs to prevent stored XSS
    const stripHtml = (
      s: string | undefined | null,
    ): string | undefined | null => {
      if (typeof s !== "string") return s;
      return s.replace(/<[^>]*>/g, "").trim();
    };

    // Build update data – only include fields that were actually sent
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) {
      const sanitizedName = stripHtml(name);
      if (!sanitizedName || sanitizedName.length < 2 || sanitizedName.length > 100) {
        return NextResponse.json(
          { error: "ERROR_NAME_MUST_BE_BETWEEN_2_AND_100_CHARACTERS" },
          { status: 400 },
        );
      }
      updateData.name = sanitizedName;
    }
    if (stageName !== undefined)
      updateData.stageName = stripHtml(stageName) || null;
    if (phone !== undefined) updateData.phone = phone || null;
    if (avatar !== undefined) updateData.avatar = avatar || null;
    if (language !== undefined) updateData.language = language;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (currency !== undefined) updateData.currency = currency;
    if (theme !== undefined) updateData.theme = theme;
    if (notifyReleases !== undefined)
      updateData.notifyReleases = !!notifyReleases;
    if (notifyRoyalties !== undefined)
      updateData.notifyRoyalties = !!notifyRoyalties;
    if (notifyNews !== undefined) updateData.notifyNews = !!notifyNews;
    if (notifyMarketing !== undefined)
      updateData.notifyMarketing = !!notifyMarketing;

    if (avatar !== undefined) {
      const existingUser = await prisma.user.findUnique({
        where: { id: payload.id as string },
        select: { avatar: true },
      });

      // Blockingly delete physical old avatar from the upload server
      if (existingUser?.avatar && existingUser.avatar !== avatar) {
        await deleteFileFromServer(existingUser.avatar);
      }
    }

    // Update user profile
    const user = await prisma.user.update({
      where: { id: payload.id as string },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        stageName: user.stageName,
        phone: user.phone,
        avatar: user.avatar,
        language: user.language,
        timezone: user.timezone,
        currency: user.currency,
        theme: user.theme,
        notifyReleases: user.notifyReleases,
        notifyRoyalties: user.notifyRoyalties,
        notifyNews: user.notifyNews,
        notifyMarketing: user.notifyMarketing,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json({ error: "ERROR_AN_ERROR_OCCURRED" }, { status: 500 });
  }
}
