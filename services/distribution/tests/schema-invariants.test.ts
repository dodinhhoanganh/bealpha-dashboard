import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDistributionConfig, normalizeDpid, resolveDspRecipient } from "../src/config.js";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

describe("distribution database invariants", () => {
  it("scopes delivery idempotency keys by tenant", () => {
    const delivery = /model Delivery \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    expect(delivery).not.toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(delivery).toContain("@@unique([tenantId, idempotencyKey])");
  });

  it("fails closed in production when the ERN-C acknowledgement schema is absent", () => {
    expect(() => loadDistributionConfig({
      NODE_ENV: "production",
      DISTRIBUTION_DATABASE_URL: "postgresql://test:test@localhost:5432/distribution",
      DISTRIBUTION_ERN_XSD_PATH: "/ddex/ern/release-notification.xsd",
      DISTRIBUTION_DDEX_AVS_VERSION_ID: "9"
    })).toThrow("DISTRIBUTION_ACK_XSD_PATH is required in production");
  });

  it("normalizes the registered human-readable DPID for DDEX XML", () => {
    expect(normalizeDpid("PA-DPIDA-2025021503-U")).toBe("PADPIDA2025021503U");
    expect(() => normalizeDpid("unregistered-party")).toThrow("Invalid DDEX Party ID");
  });

  it("normalizes recipient DPIDs and rejects unapproved placeholders", () => {
    const env = {
      NODE_ENV: "test",
      DISTRIBUTION_DATABASE_URL: "postgresql://test:test@localhost:5432/distribution",
      DISTRIBUTION_GRANT_ENCRYPTION_KEY_B64: Buffer.alloc(32).toString("base64"),
      DISTRIBUTION_EXPORT_SIGNING_KEY_B64: Buffer.alloc(32).toString("base64"),
      GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64: Buffer.alloc(64).toString("base64"),
      DISTRIBUTION_DSP_RECIPIENTS_JSON: JSON.stringify({ spotify: { partyId: "pa-dpida-2025021503-u", name: " Spotify " } })
    };
    expect(loadDistributionConfig(env).dspRecipients.spotify).toEqual({
      partyId: "PADPIDA2025021503U",
      name: "Spotify"
    });
    expect(() => loadDistributionConfig({
      ...env,
      DISTRIBUTION_DSP_RECIPIENTS_JSON: JSON.stringify({ spotify: { partyId: "REPLACE_WITH_APPROVED_DPID", name: "Spotify" } })
    })).toThrow("Invalid DSP recipient config");
    expect(loadDistributionConfig({ ...env, DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES: "true" })).toMatchObject({ autoPrepareDdexPackages: true, dspRecipients: { spotify: expect.any(Object) } });
    expect(() => loadDistributionConfig({ ...env, DISTRIBUTION_DSP_RECIPIENTS_JSON: "{}", DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES: "true" })).toThrow("release target recipients");
    expect(loadDistributionConfig({ ...env, DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID: "spotify" })).toMatchObject({ manualDdexRecipientId: "spotify" });
    const manualTargets = loadDistributionConfig({
      ...env,
      DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID: "spotify",
      DISTRIBUTION_STORE_TARGETS_JSON: JSON.stringify({ apple_music: { name: " Apple Music ", releaseTypes: ["AUDIO"] } })
    });
    expect(manualTargets.storeTargets).toEqual({ apple_music: { name: "Apple Music", recipientId: "spotify", releaseTypes: ["AUDIO"] } });
    expect(resolveDspRecipient(manualTargets, "apple_music")).toEqual({ partyId: "PADPIDA2025021503U", name: "Spotify" });
    expect(resolveDspRecipient(manualTargets, "unconfigured")).toBeUndefined();
    expect(() => loadDistributionConfig({ ...env, DISTRIBUTION_STORE_TARGETS_JSON: JSON.stringify({ apple_music: { name: "Apple Music" } }) }))
      .toThrow("Store target must map");
    expect(() => loadDistributionConfig({ ...env, DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES: "yes" })).toThrow("must be true or false");
    expect(loadDistributionConfig(env).sftpDeliveryEnabled).toBe(false);
    expect(() => loadDistributionConfig({ ...env, DISTRIBUTION_SFTP_DELIVERY_ENABLED: "yes" })).toThrow("must be true or false");
  });

  it("persists VEVO work tenant-scoped and keeps partner grants encrypted", () => {
    const submission = /model VevoSubmission \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const asset = /model VevoSubmissionAsset \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    expect(submission).toContain("@@unique([tenantId, idempotencyKey])");
    expect(submission).toContain("receiptSha256");
    expect(asset).toContain("tokenCiphertext");
    expect(asset).not.toMatch(/\btoken\s+String/);
  });
});
