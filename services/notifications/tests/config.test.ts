import { describe, expect, it } from "vitest";
import { loadNotificationConfig } from "../src/config.js";

const der = Buffer.alloc(96, 7).toString("base64");
const encryptionKey = Buffer.alloc(32, 9).toString("base64");

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    NOTIFICATION_DATABASE_URL: "postgresql://notification:test@localhost:5432/notification",
    REDIS_URL: "redis://localhost:6379/0",
    GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64: der,
    NOTIFICATION_ENCRYPTION_KEY_B64: encryptionKey,
    APP_URL: "https://dashboard.example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_REQUIRE_TLS: "true",
    SMTP_MESSAGE_ID_DOMAIN: "mail.example.com",
    ...overrides,
  };
}

describe("notification SMTP configuration", () => {
  it("requires TLS and uses an explicit Message-ID domain", () => {
    expect(loadNotificationConfig(env())).toMatchObject({
      smtpRequireTls: true,
      smtpMessageIdDomain: "mail.example.com",
    });
  });

  it("fails closed for TLS downgrade or unsafe Message-ID domains", () => {
    expect(() => loadNotificationConfig(env({ SMTP_REQUIRE_TLS: "false" }))).toThrow(
      "must require TLS"
    );
    expect(() => loadNotificationConfig(env({ SMTP_MESSAGE_ID_DOMAIN: "bad\r\nBcc:x" }))).toThrow(
      "valid DNS domain"
    );
    expect(() => loadNotificationConfig(env({ SMTP_MESSAGE_ID_DOMAIN: "" }))).toThrow(
      "required in production"
    );
  });
});
