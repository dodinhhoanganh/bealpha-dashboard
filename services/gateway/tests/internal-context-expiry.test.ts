import Fastify from "fastify";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { INTERNAL_CONTEXT_HEADER } from "@bealpha/contracts";

const services = ["identity", "catalog", "media", "distribution", "finance", "notifications", "analytics", "audit"];
const requestId = "11111111-1111-4111-8111-111111111111";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicKey: string;
beforeAll(async () => {
  keys = await generateKeyPair("ES256", { extractable: true });
  publicKey = await exportSPKI(keys.publicKey);
});

describe.each(services)("%s internal context expiration", service => {
  it.each(["valid", "missing", "expired"])("handles %s expiration before domain execution", async mode => {
    const { registerInternalAuthentication } = await import(new URL(`../../${service}/src/internal-auth.ts`, import.meta.url).href);
    const app = Fastify({ logger: false, genReqId: () => requestId });
    let calls = 0;
    await registerInternalAuthentication(app, { gatewayContextPublicKeyPem: publicKey, gatewayContextIssuer: "fixture-gateway", gatewayContextAudience: "fixture-services" });
    app.get("/probe", async () => { calls++; return { ok: true }; });
    try {
      let signer = new SignJWT({ v: 1, requestId, authType: "anonymous", roles: [], staffRoles: [] })
        .setProtectedHeader({ alg: "ES256" }).setIssuer("fixture-gateway").setAudience("fixture-services").setIssuedAt();
      if (mode !== "missing") signer = signer.setExpirationTime(mode === "valid" ? "30s" : 1);
      const response = await app.inject({ method: "GET", url: "/probe", headers: { [INTERNAL_CONTEXT_HEADER]: await signer.sign(keys.privateKey) } });
      expect(response.statusCode).toBe(mode === "valid" ? 200 : 401);
      expect(calls).toBe(mode === "valid" ? 1 : 0);
      if (mode !== "valid") expect(response.json().error.code).toBe("UNAUTHENTICATED");
    } finally { await app.close(); }
  });
});
