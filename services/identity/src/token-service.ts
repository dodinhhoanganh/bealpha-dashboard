import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { IdentityUser } from "@bealpha/contracts";
import { importPKCS8, SignJWT } from "jose";

import type { IdentityConfig } from "./config.js";

export interface RefreshTokenPair {
  raw: string;
  hash: string;
}

export class TokenService {
  private constructor(
    private readonly config: IdentityConfig,
    private readonly signingKey: CryptoKey
  ) {}

  static async create(config: IdentityConfig): Promise<TokenService> {
    const signingKey = await importPKCS8(
      config.accessTokenPrivateKeyPem,
      "ES256"
    );
    return new TokenService(config, signingKey);
  }

  createRefreshToken(): RefreshTokenPair {
    const raw = randomBytes(32).toString("base64url");
    return { raw, hash: TokenService.hashRefreshToken(raw) };
  }

  static hashRefreshToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  async issueAccessToken(user: IdentityUser, sessionId: string): Promise<string> {
    return new SignJWT({
      sessionId,
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      ...(user.tenantId === null ? {} : { tenantId: user.tenantId }),
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "identity-v1" })
      .setSubject(user.id)
      .setJti(randomUUID())
      .setIssuer(this.config.accessTokenIssuer)
      .setAudience(this.config.accessTokenAudience)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenTtlSeconds}s`)
      .sign(this.signingKey);
  }
}
