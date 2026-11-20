import { describe, expect, it } from "vitest";
import { loadIdentityConfig } from "../src/config.js";

const der = Buffer.alloc(96, 7).toString("base64");
const encryptionKey = Buffer.alloc(32, 9).toString("base64");

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    IDENTITY_DATABASE_URL: "postgresql://identity:test@localhost:5432/identity",
    IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_B64: der,
    GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64: der,
    IDENTITY_OUTBOX_ENCRYPTION_KEY_B64: encryptionKey,
    IDENTITY_TOTP_ISSUER: "BeAlpha Test",
    ...overrides,
  };
}

describe("identity 2FA configuration", () => {
  it("loads bounded TOTP and email-code policy from the environment", () => {
    const config = loadIdentityConfig(env({
      IDENTITY_TOTP_WINDOW: "0",
      IDENTITY_TOTP_STEP_SECONDS: "60",
      IDENTITY_TOTP_DIGITS: "8",
      IDENTITY_2FA_EMAIL_RATE_WINDOW_SECONDS: "900",
    }));

    expect(config).toMatchObject({
      totpIssuer: "BeAlpha Test",
      totpWindow: 0,
      totpStepSeconds: 60,
      totpDigits: 8,
      twoFactorEmailRateWindowSeconds: 900,
    });
  });

  it("fails closed for a missing issuer or an unsafe TOTP policy", () => {
    expect(() => loadIdentityConfig(env({ IDENTITY_TOTP_ISSUER: "" }))).toThrow(
      "IDENTITY_TOTP_ISSUER"
    );
    expect(() => loadIdentityConfig(env({ IDENTITY_TOTP_WINDOW: "2" }))).toThrow(
      "IDENTITY_TOTP_WINDOW"
    );
    expect(() => loadIdentityConfig(env({ IDENTITY_TOTP_DIGITS: "5" }))).toThrow(
      "IDENTITY_TOTP_DIGITS"
    );
  });
});
