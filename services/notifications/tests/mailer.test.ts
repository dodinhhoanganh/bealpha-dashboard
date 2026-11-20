import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationConfig } from "../src/config.js";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  sendMail: vi.fn().mockResolvedValue({ messageId: "provider-id" }),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}));

import { SmtpMailer } from "../src/mailer.js";

const config: NotificationConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4106,
  logLevel: "silent",
  trustProxyHops: 0,
  bodyLimitBytes: 32768,
  databaseUrl: "postgresql://test:test@localhost:5432/test",
  dbPoolMax: 1,
  gatewayContextPublicKeyPem: "",
  gatewayContextIssuer: "bealpha-gateway",
  gatewayContextAudience: "bealpha-services",
  encryptionKey: Buffer.alloc(32, 9),
  workerPollMs: 1000,
  workerMaxAttempts: 3,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  smtpRequireTls: true,
  smtpMessageIdDomain: "mail.example.com",
  smtpFrom: "noreply@example.com",
  smtpFromName: "Example Music",
  appUrl: "https://dashboard.example.com",
};

describe("SMTP mailer security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({
      close: mocks.close,
      sendMail: mocks.sendMail,
    });
  });

  it("requires STARTTLS and builds Message-ID from the configured domain", async () => {
    const mailer = new SmtpMailer(config);
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      requireTLS: true,
      tls: expect.objectContaining({ rejectUnauthorized: true }),
    }));

    await mailer.send({
      eventId: "11111111-1111-4111-8111-111111111111",
      recipient: "user@example.com",
      email: { subject: "Security alert", html: "<p>Alert</p>", text: "Alert" },
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "<11111111-1111-4111-8111-111111111111@mail.example.com>",
    }));
  });
});
