export const SERVICE_NAMES = [
  "identity",
  "catalog",
  "media",
  "distribution",
  "finance",
  "notifications",
  "analytics",
  "audit"
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface GatewayConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  trustProxyHops: number;
  bodyLimitBytes: number;
  upstreamTimeoutMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  platformHostnames: readonly string[];
  tenantDomainCacheTtlSeconds: number;
  corsOrigins: readonly string[];
  accessTokenPublicKeyPem: string;
  accessTokenIssuer: string;
  accessTokenAudience: string;
  internalContextPrivateKeyPem: string;
  internalContextIssuer: string;
  internalContextAudience: string;
  internalContextTtlSeconds: number;
  redisUrl?: string;
  serviceUrls: Readonly<Record<ServiceName, string>>;
}

function parseNodeEnv(value: string | undefined): GatewayConfig["nodeEnv"] {
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

function parseHttpUrl(name: string, value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials or path`);
  }
  return url.origin;
}

function parseRedisUrl(value: string | undefined, required: boolean): string | undefined {
  if (!value) {
    if (required) {
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

function parseCorsOrigins(value: string | undefined, production: boolean): string[] {
  const origins = (value ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || (production && origins.includes("*"))) {
    throw new Error("CORS_ORIGINS must contain explicit origins");
  }

  return origins.map((origin) => parseHttpUrl("CORS_ORIGINS", origin));
}

function parsePlatformHostnames(value: string | undefined, production: boolean): string[] {
  if (!value && production) throw new Error("GATEWAY_PLATFORM_HOSTNAMES is required in production");
  const hostnames = (value ?? "localhost,127.0.0.1").split(",").map(item => item.trim()).filter(Boolean).map(item => {
    if (/[\s/@?#]/.test(item)) throw new Error("GATEWAY_PLATFORM_HOSTNAMES contains an invalid hostname");
    const hostname = new URL(`http://${item}`).hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname) throw new Error("GATEWAY_PLATFORM_HOSTNAMES contains an invalid hostname");
    return hostname;
  });
  if (hostnames.length === 0 || new Set(hostnames).size !== hostnames.length) throw new Error("GATEWAY_PLATFORM_HOSTNAMES must contain unique hostnames");
  return hostnames;
}

export function loadGatewayConfig(
  env: NodeJS.ProcessEnv = process.env
): GatewayConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const production = nodeEnv === "production";
  const accessTokenPublicKeyPem = parseDerKey(
    "GATEWAY_ACCESS_TOKEN_PUBLIC_KEY_B64",
    env.GATEWAY_ACCESS_TOKEN_PUBLIC_KEY_B64,
    "PUBLIC KEY"
  );
  const internalContextPrivateKeyPem = parseDerKey(
    "GATEWAY_INTERNAL_CONTEXT_PRIVATE_KEY_B64",
    env.GATEWAY_INTERNAL_CONTEXT_PRIVATE_KEY_B64,
    "PRIVATE KEY"
  );

  const serviceDefaults: Record<ServiceName, string> = {
    identity: "http://identity:4101",
    catalog: "http://catalog:4102",
    media: "http://media:4103",
    distribution: "http://distribution:4104",
    finance: "http://finance:4105",
    notifications: "http://notifications:4106",
    analytics: "http://analytics:4107",
    audit: "http://audit:4108"
  };
  const serviceEnvNames: Record<ServiceName, string> = {
    identity: "IDENTITY_SERVICE_URL",
    catalog: "CATALOG_SERVICE_URL",
    media: "MEDIA_SERVICE_URL",
    distribution: "DISTRIBUTION_SERVICE_URL",
    finance: "FINANCE_SERVICE_URL",
    notifications: "NOTIFICATION_SERVICE_URL",
    analytics: "ANALYTICS_SERVICE_URL",
    audit: "AUDIT_SERVICE_URL"
  };
  const serviceUrls = Object.fromEntries(
    SERVICE_NAMES.map((service) => {
      const envName = serviceEnvNames[service];
      const value = env[envName] ?? serviceDefaults[service];
      return [service, parseHttpUrl(envName, value)];
    })
  ) as Record<ServiceName, string>;

  const redisUrl = parseRedisUrl(env.REDIS_URL, production);

  return {
    nodeEnv,
    host: env.GATEWAY_HOST ?? "0.0.0.0",
    port: parseInteger("GATEWAY_PORT", env.GATEWAY_PORT, 4000, 1, 65_535),
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxyHops: parseInteger(
      "TRUST_PROXY_HOPS",
      env.TRUST_PROXY_HOPS,
      1,
      0,
      5
    ),
    bodyLimitBytes: parseInteger(
      "GATEWAY_BODY_LIMIT_BYTES",
      env.GATEWAY_BODY_LIMIT_BYTES,
      1_048_576,
      16_384,
      10_485_760
    ),
    upstreamTimeoutMs: parseInteger(
      "GATEWAY_UPSTREAM_TIMEOUT_MS",
      env.GATEWAY_UPSTREAM_TIMEOUT_MS,
      15_000,
      250,
      120_000
    ),
    rateLimitMax: parseInteger(
      "GATEWAY_RATE_LIMIT_MAX",
      env.GATEWAY_RATE_LIMIT_MAX,
      120,
      1,
      10_000
    ),
    rateLimitWindowMs: parseInteger(
      "GATEWAY_RATE_LIMIT_WINDOW_MS",
      env.GATEWAY_RATE_LIMIT_WINDOW_MS,
      60_000,
      1_000,
      3_600_000
    ),
    platformHostnames: parsePlatformHostnames(env.GATEWAY_PLATFORM_HOSTNAMES, production),
    tenantDomainCacheTtlSeconds: parseInteger(
      "GATEWAY_TENANT_DOMAIN_CACHE_TTL_SECONDS",
      env.GATEWAY_TENANT_DOMAIN_CACHE_TTL_SECONDS,
      30,
      5,
      300
    ),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, production),
    accessTokenPublicKeyPem,
    accessTokenIssuer: env.GATEWAY_ACCESS_TOKEN_ISSUER ?? "bealpha-identity",
    accessTokenAudience: env.GATEWAY_ACCESS_TOKEN_AUDIENCE ?? "bealpha-api",
    internalContextPrivateKeyPem,
    internalContextIssuer: env.GATEWAY_INTERNAL_CONTEXT_ISSUER ?? "bealpha-gateway",
    internalContextAudience:
      env.GATEWAY_INTERNAL_CONTEXT_AUDIENCE ?? "bealpha-services",
    internalContextTtlSeconds: parseInteger(
      "GATEWAY_INTERNAL_CONTEXT_TTL_SECONDS",
      env.GATEWAY_INTERNAL_CONTEXT_TTL_SECONDS,
      30,
      5,
      300
    ),
    ...(redisUrl === undefined ? {} : { redisUrl }),
    serviceUrls
  };
}
