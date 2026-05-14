import nodemailer from "nodemailer";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

const createTransporter = () => {
  return nodemailer.createTransport({
    pool: true,
    maxConnections: 1, // Restrict to a single session as requested to prevent Google API overload
    maxMessages: 100, // Max messages per connection
    host: process.env.SMTP_HOST || "smtp-relay.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true", // false for 587
    // SMTP Relay with IP whitelisting doesn't require auth
    ...(process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        }
      : {}),
  });
};

const globalForNodemailer = global as unknown as { transporter: nodemailer.Transporter };
export const transporter = globalForNodemailer.transporter || createTransporter();
if (process.env.NODE_ENV !== "production") globalForNodemailer.transporter = transporter;

export class EmailService {
  static async sendMail({ to, subject, html }: SendEmailParams) {
    const fromName = process.env.SMTP_FROM_NAME || "BeAlpha";
    const fromEmail = process.env.SMTP_FROM || "no-reply@bealpha.com";

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
      });
      console.log(`[EmailService] Sent email to ${to}. MessageId: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`[EmailService] Error sending email to ${to}:`, error);
      throw error;
    }
  }
}
