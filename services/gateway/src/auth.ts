import {
  accessTokenClaimsSchema,
  identityAuthzVersionKey,
  identitySessionKey,
  type InternalAuthContext
} from "@bealpha/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

import type { GatewayConfig } from "./config.js";
import { sendFailure } from "./response.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: InternalAuthContext;
  }
}

const PUBLIC_REQUESTS = new Set([
  "GET /api/v1/catalog/public-tenant-brand",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/2fa/verify",
  "POST /api/v1/auth/2fa/send",
  "POST /api/v1/auth/password-reset/request",
  "POST /api/v1/auth/password-reset/confirm",
  "POST /api/v1/auth/invitations/validate",
  "POST /api/v1/auth/invitations/accept"
]);

function pathOf(request: FastifyRequest): string {
  return new URL(request.raw.url ?? "/", "http://gateway.invalid").pathname;
}

function isPublicRequest(request: FastifyRequest): boolean {
  if (request.method === "OPTIONS") {
    return true;
  }
  return PUBLIC_REQUESTS.has(`${request.method} ${pathOf(request)}`);
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
  const token = match?.[1];
  if (!token || token.length > 8192) {
    return undefined;
  }
  return token;
}

export async function registerAuthentication(
  app: FastifyInstance,
  config: GatewayConfig,
  redis?: Redis
): Promise<void> {
  const verificationKey = await importSPKI(
    config.accessTokenPublicKeyPem,
    "ES256"
  );

  app.addHook("preValidation", async (request, reply) => {
    const path = pathOf(request);
    const isApi = path.startsWith("/api/v1/");
    const token = bearerToken(request.headers.authorization);

    if (!isApi || request.method === "OPTIONS") {
      request.authContext = {
        v: 1,
        requestId: request.id,
        authType: "anonymous",
        roles: [],
        staffRoles: []
      };
      return;
    }

    if (!token) {
      if (isPublicRequest(request)) {
        request.authContext = {
          v: 1,
          requestId: request.id,
          authType: "anonymous",
          roles: [],
          staffRoles: []
        };
        return;
      }
      return sendFailure(
        reply,
        401,
        request.id,
        "UNAUTHENTICATED",
        "Valid access token required"
      );
    }

    try {
      const { payload } = await jwtVerify(token, verificationKey, {
        algorithms: ["ES256"],
        issuer: config.accessTokenIssuer,
        audience: config.accessTokenAudience,
        requiredClaims: ["exp"]
      });
      const claims = accessTokenClaimsSchema.parse({
        sub: payload.sub,
        sessionId: payload.sessionId,
        entityId: payload.entityId,
        entityType: payload.entityType,
        entityRole: payload.entityRole,
        tenantId: payload.tenantId,
        entityPath: payload.entityPath,
        roles: payload.roles ?? [],
        staffRoles: payload.staffRoles ?? [],
        authzVersion: payload.authzVersion
      });

      if (redis) {
        let registryValues: (string | null)[];
        try {
          registryValues = await redis.mget(
            identitySessionKey(claims.sessionId),
            identityAuthzVersionKey(claims.sub)
          );
        } catch (error) {
          request.log.error({ err: error }, "Identity session registry unavailable");
          return sendFailure(
            reply,
            503,
            request.id,
            "UPSTREAM_UNAVAILABLE",
            "Authentication registry unavailable"
          );
        }
        if (
          !registryValuesMatch(
            claims.sub,
            claims.authzVersion,
            registryValues
          )
        ) {
          return sendFailure(
            reply,
            401,
            request.id,
            "UNAUTHENTICATED",
            "Session is no longer valid"
          );
        }
      }

      request.authContext = {
        v: 1,
        requestId: request.id,
        authType: "user",
        actorId: claims.sub,
        sessionId: claims.sessionId,
        entityId: claims.entityId,
        entityType: claims.entityType,
        entityRole: claims.entityRole,
        ...(claims.tenantId === undefined ? {} : { tenantId: claims.tenantId }),
        ...(claims.entityPath === undefined
          ? {}
          : { entityPath: claims.entityPath }),
        roles: claims.roles,
        staffRoles: claims.staffRoles,
        authzVersion: claims.authzVersion
      };
    } catch (error) {
      request.log.info({ err: error }, "Access token rejected");
      return sendFailure(
        reply,
        401,
        request.id,
        "UNAUTHENTICATED",
        "Valid access token required"
      );
    }
  });
}

export function registryValuesMatch(
  userId: string,
  authzVersion: number,
  values: readonly (string | null)[]
): boolean {
  return values[0] === userId && values[1] === String(authzVersion);
}

export type InternalContextSigner = (
  context: InternalAuthContext
) => Promise<string>;

export async function createInternalContextSigner(
  config: GatewayConfig
): Promise<InternalContextSigner> {
  const signingKey = await importPKCS8(
    config.internalContextPrivateKeyPem,
    "ES256"
  );
  return (context) =>
    new SignJWT({ ...context })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "gateway-v1" })
      .setIssuer(config.internalContextIssuer)
      .setAudience(config.internalContextAudience)
      .setIssuedAt()
      .setExpirationTime(`${config.internalContextTtlSeconds}s`)
      .sign(signingKey);
}
