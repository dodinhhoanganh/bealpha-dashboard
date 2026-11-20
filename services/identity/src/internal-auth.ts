import {
  INTERNAL_CONTEXT_HEADER,
  internalAuthContextSchema,
  type InternalAuthContext
} from "@bealpha/contracts";
import type { FastifyInstance } from "fastify";
import { importSPKI, jwtVerify } from "jose";

import type { IdentityConfig } from "./config.js";
import { sendFailure } from "./response.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: InternalAuthContext;
  }
}

export async function registerInternalAuthentication(
  app: FastifyInstance,
  config: IdentityConfig
): Promise<void> {
  const verificationKey = await importSPKI(
    config.gatewayContextPublicKeyPem,
    "ES256"
  );

  app.addHook("preValidation", async (request, reply) => {
    const path = new URL(
      request.raw.url ?? "/",
      "http://identity.invalid"
    ).pathname;
    if (path.startsWith("/health/")) {
      request.authContext = {
        v: 1,
        requestId: request.id,
        authType: "anonymous",
        roles: [],
        staffRoles: []
      };
      return;
    }

    const token = request.headers[INTERNAL_CONTEXT_HEADER];
    if (typeof token !== "string" || token.length > 8192) {
      return sendFailure(
        reply,
        401,
        request.id,
        "UNAUTHENTICATED",
        "Signed Gateway context required"
      );
    }

    try {
      const { payload } = await jwtVerify(token, verificationKey, {
        algorithms: ["ES256"],
        issuer: config.gatewayContextIssuer,
        audience: config.gatewayContextAudience,
        requiredClaims: ["exp"]
      });
      const context = internalAuthContextSchema.parse({
        v: payload.v,
        requestId: payload.requestId,
        authType: payload.authType,
        actorId: payload.actorId,
        serviceId: payload.serviceId,
        sessionId: payload.sessionId,
        entityId: payload.entityId,
        entityType: payload.entityType,
        entityRole: payload.entityRole,
        tenantId: payload.tenantId,
        entityPath: payload.entityPath,
        roles: payload.roles,
        staffRoles: payload.staffRoles,
        authzVersion: payload.authzVersion
      });
      if (context.requestId !== request.id) {
        throw new Error("Gateway request ID mismatch");
      }
      request.authContext = context;
    } catch (error) {
      request.log.info({ err: error }, "Gateway context rejected");
      return sendFailure(
        reply,
        401,
        request.id,
        "UNAUTHENTICATED",
        "Signed Gateway context required"
      );
    }
  });
}
