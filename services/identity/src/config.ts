export interface IdentityConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  trustProxyHops: number;
  bodyLimitBytes: number;
  databaseUrl: string;
  dbPoolMax: number;
  redisUrl?: string;
  accessTokenPrivateKeyPem: string;
  accessTokenIssuer: string;
  accessTokenAudience: string;
  accessTokenTtlSeconds: number;
  gatewayContextPublicKeyPem: string;
  gatewayContextIssuer: string;
  gatewayContextAudience: string;
  refreshCookieName: string;
  cookieSecure: boolean;
  refreshTtlSeconds: number;
  rememberRefreshTtlSeconds: number;
  bcryptCost: number;
  maxLoginAttempts: number;
  lockoutSeconds: number;
  twoFactorChallengeTtlSeconds: number;
  maxTwoFactorAttempts: number;
  totpIssuer: string;
  totpWindow: number;
  totpStepSeconds: number;
  totpDigits: number;
  passwordResetTtlSeconds: number;
  passwordResetCooldownSeconds: number;
  outboxEncryptionKey: Buffer;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
  invitationTtlSeconds: number;
  invitationResendCooldownSeconds: number;
  twoFactorEmailCodeTtlSeconds: number;
  twoFactorEmailCooldownSeconds: number;
  twoFactorEmailMaxSends: number;
  twoFactorEmailRateWindowSeconds: number;
}

function parseNodeEnv(value: string | undefined): IdentityConfig["nodeEnv"] {
  if (value === "production" || value === "test") {
    return value;
  }
  return "development";
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseDerKey(
  name: string,
  value: string | undefined,
  label: "PUBLIC KEY" | "PRIVATE KEY"
): string {
  if (
    !value ||
    /change[_-]?me/i.test(value) ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error(`${name} must be a base64-encoded DER ${label}`);
  }
  const der = Buffer.from(value, "base64");
  if (der.length < 64 || der.length > 8192) {
    throw new Error(`${name} has an invalid DER key length`);
  }
  const body = der.toString("base64").match(/.{1,64}/g)?.join("\n");
  if (!body) {
    throw new Error(`${name} could not be decoded`);
  }
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

function parseDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("IDENTITY_DATABASE_URL is required");
  }
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("IDENTITY_DATABASE_URL must use PostgreSQL");
  }
  return value;
}

function parseRedisUrl(
  value: string | undefined,
  production: boolean
): string | undefined {
  if (!value) {
    if (production) {
      throw new Error("REDIS_URL is required in production");
    }
    return undefined;
  }
  const url = new URL(value);
  if (!["redis:", "rediss:"].includes(url.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  return value;
}

function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value || /change[_-]?me/i.test(value)) {
    throw new Error("IDENTITY_OUTBOX_ENCRYPTION_KEY_B64 is required");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("IDENTITY_OUTBOX_ENCRYPTION_KEY_B64 must decode to 32 bytes");
  }
  return key;
}

function parseRequiredText(name: string, value: string | undefined, max: number): string {
  const parsed = value?.trim();
  if (!parsed || parsed.length > max || /[\r\n\0]/.test(parsed)) {
    throw new Error(`${name} is required and must be at most ${max} characters`);
  }
  return parsed;
}

export function loadIdentityConfig(
  env: NodeJS.ProcessEnv = process.env
): IdentityConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const redisUrl = parseRedisUrl(env.REDIS_URL, nodeEnv === "production");

  return {
    nodeEnv,
    host: env.IDENTITY_HOST ?? "0.0.0.0",
    port: parseInteger("IDENTITY_PORT", env.IDENTITY_PORT, 4101, 1, 65_535),
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxyHops: parseInteger(
      "TRUST_PROXY_HOPS",
      env.TRUST_PROXY_HOPS,
      1,
      0,
      5
    ),
    bodyLimitBytes: parseInteger(
      "IDENTITY_BODY_LIMIT_BYTES",
      env.IDENTITY_BODY_LIMIT_BYTES,
      16_384,
      4_096,
      65_536
    ),
    databaseUrl: parseDatabaseUrl(env.IDENTITY_DATABASE_URL),
    dbPoolMax: parseInteger("IDENTITY_DB_POOL_MAX", env.IDENTITY_DB_POOL_MAX, 10, 1, 50),
    ...(redisUrl === undefined ? {} : { redisUrl }),
    accessTokenPrivateKeyPem: parseDerKey(
      "IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_B64",
      env.IDENTITY_ACCESS_TOKEN_PRIVATE_KEY_B64,
      "PRIVATE KEY"
    ),
    accessTokenIssuer: env.IDENTITY_ACCESS_TOKEN_ISSUER ?? "bealpha-identity",
    accessTokenAudience: env.IDENTITY_ACCESS_TOKEN_AUDIENCE ?? "bealpha-api",
    accessTokenTtlSeconds: parseInteger(
      "IDENTITY_ACCESS_TOKEN_TTL_SECONDS",
      env.IDENTITY_ACCESS_TOKEN_TTL_SECONDS,
      900,
      60,
      3_600
    ),
    gatewayContextPublicKeyPem: parseDerKey(
      "GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64",
      env.GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64,
      "PUBLIC KEY"
    ),
    gatewayContextIssuer:
      env.GATEWAY_INTERNAL_CONTEXT_ISSUER ?? "bealpha-gateway",
    gatewayContextAudience:
      env.GATEWAY_INTERNAL_CONTEXT_AUDIENCE ?? "bealpha-services",
    refreshCookieName: env.IDENTITY_REFRESH_COOKIE_NAME ?? "bealpha_refresh",
    cookieSecure: env.IDENTITY_COOKIE_SECURE != null
      ? env.IDENTITY_COOKIE_SECURE === "true"
      : nodeEnv === "production",
    refreshTtlSeconds: parseInteger(
      "IDENTITY_REFRESH_TTL_SECONDS",
      env.IDENTITY_REFRESH_TTL_SECONDS,
      604_800,
      3_600,
      2_592_000
    ),
    rememberRefreshTtlSeconds: parseInteger(
      "IDENTITY_REMEMBER_REFRESH_TTL_SECONDS",
      env.IDENTITY_REMEMBER_REFRESH_TTL_SECONDS,
      2_592_000,
      86_400,
      7_776_000
    ),
    bcryptCost: parseInteger("IDENTITY_BCRYPT_COST", env.IDENTITY_BCRYPT_COST, 12, 10, 14),
    maxLoginAttempts: parseInteger(
      "IDENTITY_MAX_LOGIN_ATTEMPTS",
      env.IDENTITY_MAX_LOGIN_ATTEMPTS,
      5,
      3,
      20
    ),
    lockoutSeconds: parseInteger(
      "IDENTITY_LOCKOUT_SECONDS",
      env.IDENTITY_LOCKOUT_SECONDS,
      900,
      60,
      86_400
    ),
    twoFactorChallengeTtlSeconds: parseInteger(
      "IDENTITY_2FA_CHALLENGE_TTL_SECONDS",
      env.IDENTITY_2FA_CHALLENGE_TTL_SECONDS,
      600,
      60,
      1_800
    ),
    maxTwoFactorAttempts: parseInteger(
      "IDENTITY_2FA_MAX_ATTEMPTS",
      env.IDENTITY_2FA_MAX_ATTEMPTS,
      5,
      3,
      10
    ),
    totpIssuer: parseRequiredText("IDENTITY_TOTP_ISSUER", env.IDENTITY_TOTP_ISSUER, 64),
    totpWindow: parseInteger("IDENTITY_TOTP_WINDOW", env.IDENTITY_TOTP_WINDOW, 1, 0, 1),
    totpStepSeconds: parseInteger("IDENTITY_TOTP_STEP_SECONDS", env.IDENTITY_TOTP_STEP_SECONDS, 30, 30, 60),
    totpDigits: parseInteger("IDENTITY_TOTP_DIGITS", env.IDENTITY_TOTP_DIGITS, 6, 6, 8),
    passwordResetTtlSeconds: parseInteger(
      "IDENTITY_PASSWORD_RESET_TTL_SECONDS",
      env.IDENTITY_PASSWORD_RESET_TTL_SECONDS,
      1800,
      300,
      7200
    ),
    passwordResetCooldownSeconds: parseInteger(
      "IDENTITY_PASSWORD_RESET_COOLDOWN_SECONDS",
      env.IDENTITY_PASSWORD_RESET_COOLDOWN_SECONDS,
      60,
      30,
      900
    ),
    outboxEncryptionKey: parseEncryptionKey(
      env.IDENTITY_OUTBOX_ENCRYPTION_KEY_B64
    ),
    outboxPollIntervalMs: parseInteger(
      "IDENTITY_OUTBOX_POLL_INTERVAL_MS",
      env.IDENTITY_OUTBOX_POLL_INTERVAL_MS,
      1000,
      250,
      60000
    ),
    outboxBatchSize: parseInteger(
      "IDENTITY_OUTBOX_BATCH_SIZE",
      env.IDENTITY_OUTBOX_BATCH_SIZE,
      25,
      1,
      100
    ),
    invitationTtlSeconds: parseInteger(
      "IDENTITY_INVITATION_TTL_SECONDS",
      env.IDENTITY_INVITATION_TTL_SECONDS,
      604800,
      3600,
      2592000
    ),
    invitationResendCooldownSeconds: parseInteger(
      "IDENTITY_INVITATION_RESEND_COOLDOWN_SECONDS",
      env.IDENTITY_INVITATION_RESEND_COOLDOWN_SECONDS,
      60,
      30,
      3600
    ),
    twoFactorEmailCodeTtlSeconds: parseInteger(
      "IDENTITY_2FA_EMAIL_CODE_TTL_SECONDS",
      env.IDENTITY_2FA_EMAIL_CODE_TTL_SECONDS,
      600,
      60,
      1800
    ),
    twoFactorEmailCooldownSeconds: parseInteger(
      "IDENTITY_2FA_EMAIL_COOLDOWN_SECONDS",
      env.IDENTITY_2FA_EMAIL_COOLDOWN_SECONDS,
      60,
      30,
      900
    ),
    twoFactorEmailMaxSends: parseInteger(
      "IDENTITY_2FA_EMAIL_MAX_SENDS",
      env.IDENTITY_2FA_EMAIL_MAX_SENDS,
      5,
      1,
      10
    ),
    twoFactorEmailRateWindowSeconds: parseInteger(
      "IDENTITY_2FA_EMAIL_RATE_WINDOW_SECONDS",
      env.IDENTITY_2FA_EMAIL_RATE_WINDOW_SECONDS,
      600,
      60,
      3600
    )
  };
}
