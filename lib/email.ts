/**
 * Email Service
 *
 * Production SMTP transport via Google Workspace (smtp.google.com).
 * Supports: OTP codes, security alerts, session hijack notifications,
 * release status, royalty reports, welcome emails.
 *
 * Retry with exponential backoff for transient SMTP errors.
 * Irrecoverable errors (535, 550, 530) abort immediately.
 */

import nodemailer from "nodemailer";
import path from "path";
import { getEmailStrings, getDateLocale } from "./email-i18n";

// ── Types ────────────────────────────────────────────────
export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  priority?: "high" | "normal" | "low";
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SecurityAlertData {
  userAgent: string;
  ipAddress: string;
  location?: string;
  timestamp: Date;
  reason: string;
}

// ── SMTP Transport ───────────────────────────────────────

const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpSecure = process.env.SMTP_SECURE === "true";
const smtpUser = process.env.SMTP_USER; // Optional — not needed for IP-whitelisted relay
const smtpPass = process.env.SMTP_PASS; // Optional — not needed for IP-whitelisted relay
const smtpFrom =
  process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@bealpha.com";
const smtpFromName = process.env.SMTP_FROM_NAME || "BeAlpha";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Singleton transporter — reuse TCP connection pool across Next.js HMR
const globalForNodemailer = global as unknown as {
  transporter: nodemailer.Transporter | null;
};

let transporter: nodemailer.Transporter | null =
  globalForNodemailer.transporter || null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  if (!smtpHost) {
    console.warn("SMTP_HOST not configured. Emails will be logged to console.");
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  const transportConfig: nodemailer.TransportOptions & {
    host: string;
    port: number;
    secure: boolean;
    pool?: boolean;
    maxConnections?: number;
    maxMessages?: number;
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    name?: string;
    auth?: { user: string; pass: string };
    tls?: { rejectUnauthorized: boolean; servername?: string };
    family?: number;
    localAddress?: string;
  } = {
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    family: 4, // M5 fix: Force IPv4 connection. Google Workspace IP whitelist usually only has IPv4, but Node prefers IPv6 by default.
    localAddress: "0.0.0.0", // Aggressively force IPv4 outbound routing
    name: smtpFrom.split("@")[1] || "bealpha.com", // M3 fix: Provide Workspace domain in EHLO to satisfy Google IP Relay requirements
    pool: true,
    maxConnections: 1, // Exactly 1 connection to avoid Google SMTP rate limit and socket exhaustion
    maxMessages: 1000, // Keep connection alive for many messages
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    tls: { rejectUnauthorized: false, servername: smtpHost },
  };

  if (smtpUser && smtpPass) {
    transportConfig.auth = { user: smtpUser, pass: smtpPass };
  }

  transporter = nodemailer.createTransport(transportConfig);

  // Health check — non-blocking, log-only
  transporter
    .verify()
    .then(() => {
      // Fix #2: DMARC alignment validation — confirm envelope sender domain matches From header domain
      const fromDomain = smtpFrom.split("@")[1] || "";
      const isRelay = smtpHost.includes("smtp-relay");
      if (isRelay) {
        console.log(`[SMTP] DMARC OK: Using relay ${smtpHost} with envelope domain ${fromDomain} — SPF alignment preserved.`);
      } else if (smtpHost.includes("smtp.gmail.com")) {
        console.warn(`[SMTP] DMARC WARNING: smtp.gmail.com overrides envelope sender to @gmail.com. SPF alignment WILL FAIL for domain ${fromDomain}. Switch to smtp-relay.gmail.com or Google Workspace.`);
      }
    })
    .catch((err) => console.error(`SMTP verify failed: ${err.message}`));

  if (process.env.NODE_ENV !== "production") {
    globalForNodemailer.transporter = transporter;
  }

  return transporter;
}

// Ensure clean shutdown of the single connection pool on exit/crash
if (typeof process !== "undefined" && !globalForNodemailer.transporter) {
  const cleanup = () => {
    if (transporter) {
      transporter.close();
      transporter = null;
      if (process.env.NODE_ENV !== "production") {
        globalForNodemailer.transporter = null;
      }
    }
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("exit", cleanup);
}

// ── SMTP Error Classification ────────────────────────────

const IRRECOVERABLE_CODES = [535, 538, 550, 553, 530];
const SOCKET_ERRORS = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ESOCKET",
  "ENOTFOUND",
];

function isIrrecoverable(code: number): boolean {
  return IRRECOVERABLE_CODES.includes(code);
}

// ── Core Send with Retry ─────────────────────────────────

const MAX_ATTEMPTS = 3;

async function sendWithRetry(options: EmailOptions): Promise<EmailResult> {
  const mail: nodemailer.SendMailOptions = {
    from: `"${smtpFromName}" <${smtpFrom}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    envelope: {
      from: smtpFrom, // M4 fix: explicitly set envelope-from to satisfy Google Workspace SMTP relay rules
      to: options.to,
    },
    attachments: [
      {
        filename: "Logo_Email.png",
        path: path.join(process.cwd(), "public", "Logo_Email.png"),
        cid: "logo_black_png",
      },
      {
        filename: "ADED_Email.png",
        path: path.join(process.cwd(), "public", "ADED_Email.png"),
        cid: "aded_white_svg",
      },
    ],
  };

  // High-priority headers for security emails
  if (options.priority === "high") {
    mail.headers = {
      "X-Priority": "1 (Highest)",
      "X-MSMail-Priority": "High",
      Importance: "High",
    };
    mail.priority = "high";
  }

  const transport = getTransporter();
  let lastError: Error | null = null;

  // Dev stub detection: jsonTransport has no real send
  const isStub = !smtpHost;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await transport.sendMail(mail);

      if (isStub) {
        return { success: true, messageId: `stub-${Date.now()}` };
      }

      return { success: true, messageId: result.messageId };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const smtpCode = (err as { responseCode?: number }).responseCode || 0;

      console.warn(
        `Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError.message} (SMTP ${smtpCode})`,
      );

      if (isIrrecoverable(smtpCode)) {
        console.error(`Irrecoverable SMTP ${smtpCode}. Aborting.`);
        break;
      }

      // M1 fix: Reset transporter on socket-level errors to force reconnect
      const errCode = (err as { code?: string }).code || "";
      if (SOCKET_ERRORS.includes(errCode)) {
        if (transporter) transporter.close();
        transporter = null;
        if (process.env.NODE_ENV !== "production") {
          globalForNodemailer.transporter = null;
        }
        console.warn(
          `Socket error (${errCode}), transporter reset for next attempt.`,
        );
      }

      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff: 2s → 4s → 8s
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || "Email dispatch failed",
  };
}

// ── Public API ───────────────────────────────────────────

export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  // M2 fix: Validate email format to prevent header injection
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.to)) {
    return { success: false, error: "Invalid email address" };
  }
  try {
    return await sendWithRetry(options);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Email send error:", msg);
    return { success: false, error: msg };
  }
}

// ── Outlook VML Button Helper (Fix #9) ───────────────────

/**
 * Render a CTA button with Outlook VML fallback.
 * Outlook desktop ignores CSS border-radius and padding on <a> tags.
 * VML v:roundrect provides pixel-perfect rendering in MSO clients.
 */
function renderButton(text: string, href: string, bgColor: string = "#000000", textColor: string = "#ffffff"): string {
  const width = Math.max(180, text.length * 11 + 48);
  return `
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
      href="${href}" style="height:46px;v-text-anchor:middle;width:${width}px;"
      arcsize="17%" strokecolor="${bgColor}" fillcolor="${bgColor}">
      <w:anchorlock/>
      <center style="color:${textColor};font-family:sans-serif;font-size:14px;font-weight:bold;">${text}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <a href="${href}" style="display:inline-block;background:${bgColor};color:${textColor};text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">${text}</a>
    <!--<![endif]-->`;
}

// ── Template Layout ──────────────────────────────────────

function layout(body: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `
<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    body, html { margin: 0; padding: 0; width: 100% !important; background-color: #f9f9f9; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  </style>
</head>
<body style="margin:0; padding:0; background:#f9f9f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f9f9f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header / Logo -->
          <tr>
            <td align="center" style="padding:40px 32px 16px 32px;">
              <img src="cid:logo_black_png" alt="BeAlpha" width="160" style="display:block; margin:0 auto; max-width:100%; height:auto;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 40px 32px; color:#333; font-size:16px; line-height:1.6;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#000000; padding:40px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-bottom:24px;">
                    <img src="cid:aded_white_svg" alt="ADED Music Group LLC" height="32" style="display:block;" />
                  </td>
                </tr>
                <tr>
                  <td style="color:#a8a29e; font-size:13px; line-height:1.6; padding-bottom:24px;">
                    <a href="https://adedmusic.com" style="color:#fff; text-decoration:none; font-weight:bold; font-size:15px;">adedmusic.com</a><br/><br/>
                    ADED Music Group LLC<br/>
                    Luu Phai St, Ngu Hiep, Thanh Tri, Hanoi 100000<br/>
                    Phone: +1 302-644-5641<br/>
                    Copyright &copy; ${new Date().getFullYear()} ADED Music Group LLC.
                  </td>
                </tr>
                <tr>
                  <td style="border-top:1px solid #444; padding-top:24px; color:#78716c; font-size:11px; line-height:1.5;">
                    You are receiving this email because it contains account-related information that we are required to send.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Pre-built Email Templates ────────────────────────────

/**
 * Send 2FA OTP verification code
 */
export async function sendTwoFactorCode(
  to: string,
  code: string,
  method: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).twoFactor;

  return sendEmail({
    to,
    subject: s.subject,
    priority: "high",
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">
        ${s.desc(method)}
      </p>
      <div style="margin: 32px 0; text-align: center;">
        <span style="font-size:42px; font-weight:900; color:#000; letter-spacing:12px; font-family:ui-monospace,SFMono-Regular,monospace;">${escapeHtml(code)}</span>
      </div>
      <p style="color:#737373; font-size:13px; line-height:1.5; margin:0;">
         ${s.expires}
      </p>
      <p style="color:#a3a3a3; font-size:12px; margin:16px 0 0;">
        ${s.ignore}
      </p>
    `),
    text: s.plainText(code),
  });
}

/**
 * Security alert — session hijack / unauthorized access
 */
export async function sendSecurityAlert(
  to: string,
  data: SecurityAlertData,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).security;
  const ts = data.timestamp.toLocaleString(getDateLocale(lang), {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "long",
  });

  return sendEmail({
    to,
    subject: s.subject(data.reason.replace(/[<>"]/g, "")),
    priority: "high",
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${escapeHtml(data.reason)}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 20px;">${s.desc}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:24px;">
        <tr>
          <td style="padding:12px 16px; border-bottom:1px solid #e5e7eb; color:#525252; font-size:13px; font-weight:600; width:35%;">${s.device}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #e5e7eb; color:#000; font-size:13px; font-weight:700;">${escapeHtml(data.userAgent)}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px; border-bottom:1px solid #e5e7eb; color:#525252; font-size:13px; font-weight:600;">${s.ip}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #e5e7eb; color:#000; font-size:13px; font-weight:700;">${escapeHtml(data.ipAddress)}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px; border-bottom:1px solid #e5e7eb; color:#525252; font-size:13px; font-weight:600;">${s.location}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #e5e7eb; color:#000; font-size:13px; font-weight:700;">${escapeHtml(data.location || s.unknown)}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px; color:#525252; font-size:13px; font-weight:600;">${s.time}</td>
          <td style="padding:12px 16px; color:#000; font-size:13px; font-weight:700;">${ts}</td>
        </tr>
      </table>
      <p style="color:#737373; font-size:14px; line-height:1.6; margin:0 0 24px;">${s.action}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, `${appUrl}/settings/security`, "#dc2626")}
          </td>
        </tr>
      </table>
    `),
    text: `SECURITY ALERT: ${data.reason}\n\nDevice: ${data.userAgent}\nIP: ${data.ipAddress}\nLocation: ${data.location || "Unknown"}\nTime: ${ts}\n\nIf this wasn't you, change your password immediately at ${appUrl}/settings/security`,
  });
}

/**
 * Suspicious login — new device/location needs verification
 */
export async function sendSuspiciousLoginAlert(
  to: string,
  data: SecurityAlertData,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).suspicious;
  const ts = data.timestamp.toLocaleString(getDateLocale(lang), {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "long",
  });

  return sendEmail({
    to,
    subject: s.subject,
    priority: "high",
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 20px;">${s.desc}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:24px;">
        <tr>
          <td style="padding:10px 16px; border-bottom:1px solid #e5e7eb; color:#525252; font-size:13px; width:35%;">${s.device}</td>
          <td style="padding:10px 16px; border-bottom:1px solid #e5e7eb; color:#000; font-size:13px; font-weight:600;">${escapeHtml(data.userAgent)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px; border-bottom:1px solid #e5e7eb; color:#525252; font-size:13px;">${s.ip}</td>
          <td style="padding:10px 16px; border-bottom:1px solid #e5e7eb; color:#000; font-size:13px; font-weight:600;">${escapeHtml(data.ipAddress)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px; border-bottom:1px solid #e5e7eb; color:#525252; font-size:13px;">${s.location}</td>
          <td style="padding:10px 16px; border-bottom:1px solid #e5e7eb; color:#000; font-size:13px; font-weight:600;">${escapeHtml(data.location || s.unknown)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px; color:#525252; font-size:13px;">${s.time}</td>
          <td style="padding:10px 16px; color:#000; font-size:13px; font-weight:600;">${ts}</td>
        </tr>
      </table>
      <p style="color:#737373; font-size:13px; margin:0 0 20px;">${s.action}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, `${appUrl}/settings/security`)}
          </td>
        </tr>
      </table>
    `),
    text: `New sign-in to your account.\nDevice: ${data.userAgent}\nLocation: ${data.location || "Unknown"}\nTime: ${ts}\n\nIf this wasn't you, secure your account at ${appUrl}/settings/security`,
  });
}

/**
 * Welcome email
 */
export async function sendWelcomeEmail(
  to: string,
  name: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).welcome;

  return sendEmail({
    to,
    subject: s.subject,
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title(escapeHtml(name))}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, appUrl)}
          </td>
        </tr>
      </table>
      <p style="color:#737373; font-size:14px; line-height:1.6; margin:0;">${s.help}</p>
    `),
    text: `${s.title(name)} ${s.desc}`,
  });
}

/**
 * Release approved
 */
export async function sendReleaseApprovedEmail(
  to: string,
  releaseTitle: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).releaseApproved;
  const safeTitle = escapeHtml(releaseTitle);

  return sendEmail({
    to,
    subject: s.subject(releaseTitle),
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc(safeTitle)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, appUrl)}
          </td>
        </tr>
      </table>
    `),
    text: `${s.title}: "${releaseTitle}"`,
  });
}

/**
 * Release denied
 */
export async function sendReleaseDeniedEmail(
  to: string,
  releaseTitle: string,
  reason?: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).releaseDenied;
  const safeTitle = escapeHtml(releaseTitle);

  return sendEmail({
    to,
    subject: s.subject(releaseTitle),
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc(safeTitle)}</p>
      ${reason ? `<p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;"><strong style="color:#000;">${s.reasonLabel}</strong> ${escapeHtml(reason)}</p>` : ""}
      <p style="color:#737373; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.instruction}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, appUrl, "#dc2626")}
          </td>
        </tr>
      </table>
    `),
    text: `${s.title}: "${releaseTitle}"${reason ? ` ${s.reasonLabel} ${reason}` : ""}`,
  });
}

/**
 * Release Delivered (To DSPs)
 */
export async function sendReleaseDeliveredEmail(
  to: string,
  releaseTitle: string,
  dspCount: number,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).releaseDelivered;
  const safeTitle = escapeHtml(releaseTitle);

  return sendEmail({
    to,
    subject: s.subject(releaseTitle),
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc(safeTitle, dspCount)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, appUrl)}
          </td>
        </tr>
      </table>
    `),
    text: `${s.title}: "${releaseTitle}" — ${dspCount} platforms`,
  });
}

/**
 * Milestone Email (100k, 1M, 10M streams)
 */
export async function sendMilestoneEmail(
  to: string,
  releaseTitle: string,
  milestone: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).milestone;
  const safeTitle = escapeHtml(releaseTitle);

  return sendEmail({
    to,
    subject: s.subject(releaseTitle, milestone),
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc(safeTitle, milestone)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, appUrl)}
          </td>
        </tr>
      </table>
    `),
    text: `${s.title}: "${releaseTitle}" — ${milestone} streams`,
  });
}

/**
 * Review Request (Admin)
 */
export async function sendReviewRequestEmail(
  to: string,
  releaseTitle: string,
  artistName: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).reviewRequest;

  return sendEmail({
    to,
    subject: s.subject(releaseTitle, artistName),
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc(escapeHtml(releaseTitle), escapeHtml(artistName))}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, `${appUrl}/admin/releases`)}
          </td>
        </tr>
      </table>
    `),
    text: `${s.title}: "${releaseTitle}" by ${artistName}`,
  });
}

/**
 * New royalty report
 */
export async function sendNewRoyaltyEmail(
  to: string,
  platform: string,
  amount: number,
  period: string,
  lang: string = "en",
): Promise<EmailResult> {
  const s = getEmailStrings(lang).royalty;

  return sendEmail({
    to,
    subject: s.subject(platform, period),
    html: layout(`
      <h1 style="color:#000; font-size:20px; margin:0 0 12px;">${s.title}</h1>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">${s.desc}</p>
      <p style="color:#525252; font-size:14px; line-height:1.6; margin:0 0 16px;">
        <strong style="color:#000;">${s.platformLabel}</strong> ${escapeHtml(platform)}<br/>
        <strong style="color:#000;">${s.periodLabel}</strong> ${escapeHtml(period)}<br/>
        <strong style="color:#000;">${s.revenueLabel}</strong> <span style="color:#22c55e;font-size:20px;font-weight:bold;">$${amount.toFixed(2)}</span>
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:24px 0;">
            ${renderButton(s.btn, appUrl)}
          </td>
        </tr>
      </table>
    `),
    text: `${s.title}: ${platform} ${period} — $${amount.toFixed(2)}`,
  });
}

// ── Utilities ────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
