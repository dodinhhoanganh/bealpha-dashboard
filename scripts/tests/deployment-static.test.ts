import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const compose = readFileSync(path.join(root, "docker-compose.microservices.yml"), "utf8");
const services = ["gateway", "identity", "catalog", "media", "distribution", "finance", "notifications", "analytics", "audit"];

test("local bootstrap uses serial builds with Bake disabled", () => {
  for (const file of [".env.example", ".env.microservices.example"]) {
    const content = readFileSync(path.join(root, file), "utf8");
    assert.ok(/^COMPOSE_PARALLEL_LIMIT=1\r?$/m.test(content), `${file}: serial build default required`);
    assert.ok(/^COMPOSE_BAKE=false\r?$/m.test(content), `${file}: Bake must default off`);
  }
  const bootstrap = readFileSync(path.join(root, "scripts/bootstrap-local.ps1"), "utf8");
  assert.match(bootstrap, /COMPOSE_PARALLEL_LIMIT = "1"/);
  assert.match(bootstrap, /COMPOSE_BAKE = "false"/);
});

function block(name: string) {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:|^volumes:|^networks:)`, "m").exec(compose);
  assert.ok(match, `Missing Compose service ${name}`);
  return match[0];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "generated") return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith(".ts") ? [target] : [];
  });
}

test("every domain service is independently buildable", () => {
  for (const service of services) {
    const directory = path.join(root, "services", service);
    assert.ok(existsSync(path.join(directory, "Dockerfile")), `${service} Dockerfile`);
    assert.ok(existsSync(path.join(directory, "package.json")), `${service} package`);
    assert.ok(existsSync(path.join(directory, "tests")), `${service} tests`);
    const dockerfile = readFileSync(path.join(directory, "Dockerfile"), "utf8");
    assert.match(dockerfile, /^USER\s+\S+/m, `${service} non-root user`);
    assert.match(dockerfile, /^HEALTHCHECK\s+/m, `${service} image healthcheck`);
    assert.match(dockerfile, /packages\/contracts\/node_modules/, `${service} contracts runtime dependencies`);
    if (service !== "gateway") {
      assert.ok(existsSync(path.join(directory, "prisma", "schema.prisma")), `${service} schema`);
      assert.ok(existsSync(path.join(directory, "prisma", "migrations")), `${service} migrations`);
    }
  }
});

test("Compose keeps services private and resource bounded", () => {
  for (const service of services) {
    const source = block(service);
    assert.match(source, /healthcheck:/, `${service} healthcheck`);
    assert.match(source, /mem_limit:/, `${service} memory limit`);
    assert.match(source, /cpus:/, `${service} CPU limit`);
    assert.match(source, /pids_limit:/, `${service} PID limit`);
    assert.doesNotMatch(source, /^    ports:/m, `${service} host ports`);
  }
  for (const worker of ["catalog-import-worker", "catalog-saga-worker", "media-worker", "media-saga-worker", "distribution-worker", "distribution-saga-worker", "finance-worker", "notifications-worker", "analytics-worker", "audit-worker"]) {
    const source = block(worker);
    assert.match(source, /healthcheck:/, `${worker} healthcheck`);
    assert.match(source, /mem_limit:/, `${worker} memory limit`);
    assert.match(source, /cpus:/, `${worker} CPU limit`);
    assert.match(source, /pids_limit:/, `${worker} PID limit`);
  }
  assert.match(block("nginx"), /^    ports:/m);
  assert.doesNotMatch(block("postgres"), /^    ports:/m);
  assert.doesNotMatch(compose, /tmpfs:\s*\[\/tmp:/, "inline tmpfs paths must be quoted");
  assert.match(compose, /backend:\r?\n    driver: bridge\r?\n    internal: true/);
  assert.match(block("nginx"), /\/var\/cache\/nginx:[^\n]*uid=101,gid=101,mode=0750/);
  for (const migration of ["identity-migrate", "catalog-migrate", "media-migrate", "distribution-migrate", "finance-migrate", "notifications-migrate", "analytics-migrate", "audit-migrate"]) {
    assert.match(block(migration), /restart: ["']on-failure:3["']/, `${migration} transient database retry`);
  }
});

test("dashboard is UI-only and default Compose selects microservices", () => {
  const apiRoot = path.join(root, "bealpha-dashboard", "app", "api");
  const apiFiles = existsSync(apiRoot) ? readdirSync(apiRoot, { recursive: true }).filter(item => String(item).endsWith("route.ts")) : [];
  assert.deepEqual(apiFiles, []);
  assert.equal(existsSync(path.join(root, "bealpha-dashboard", "prisma")), false);
  assert.equal(existsSync(path.join(root, "bealpha-dashboard", "prisma.config.ts")), false);
  assert.equal(existsSync(path.join(root, "bealpha-dashboard", "lib", "rate-limit.ts")), false);
  for (const serverOnlyFile of [
    "lib/dsp/spotify-token.ts",
    "lib/client-ip.ts",
    "lib/cron-auth.ts",
    "lib/allowed-origins.ts",
    "lib/request-size.ts",
    "lib/security/safe-path.ts",
    "lib/security.ts",
    "lib/cache.ts"
  ]) {
    assert.equal(existsSync(path.join(root, "bealpha-dashboard", serverOnlyFile)), false, `${serverOnlyFile} must stay outside dashboard`);
  }
  const dashboardPackage = readFileSync(path.join(root, "bealpha-dashboard", "package.json"), "utf8");
  assert.doesNotMatch(dashboardPackage, /@prisma|"prisma"|bcryptjs|nodemailer|ssh2-sftp-client/);
  const dashboardJest = readFileSync(path.join(root, "bealpha-dashboard", "jest.config.js"), "utf8");
  assert.doesNotMatch(dashboardJest, /app\/api|lib\/prisma/);
  assert.match(readFileSync(path.join(root, "docker-compose.yml"), "utf8"), /docker-compose\.microservices\.yml/);
  assert.doesNotMatch(block("dashboard"), /profiles:\s*\r?\n\s*- edge/);
  assert.doesNotMatch(block("nginx"), /profiles:\s*\r?\n\s*- edge/);
});

test("service boundaries and Gateway routing remain explicit", () => {
  for (const service of services) {
    const packageJson = JSON.parse(readFileSync(path.join(root, "services", service, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const internalDependencies = Object.keys(packageJson.dependencies ?? {}).filter(name => name.startsWith("@bealpha/") && name !== "@bealpha/contracts");
    assert.deepEqual(internalDependencies, [], `${service} must use HTTP/events instead of domain package imports`);
    for (const file of sourceFiles(path.join(root, "services", service, "src"))) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /(?:\.\.\/){2,}(?:identity|catalog|media|distribution|finance|notifications|analytics|audit)(?:\/|["'])/, `${service} cross-service source import in ${file}`);
    }
  }

  const proxy = readFileSync(path.join(root, "services", "gateway", "src", "proxy.ts"), "utf8");
  const expectedRoutes: Record<string, string> = {
    auth: "identity",
    identity: "identity",
    catalog: "catalog",
    media: "media",
    distribution: "distribution",
    finance: "finance",
    notifications: "notifications",
    analytics: "analytics",
    audit: "audit"
  };
  for (const [prefix, service] of Object.entries(expectedRoutes)) {
    assert.match(proxy, new RegExp(`\\b${prefix}: ["']${service}["']`), `${prefix} Gateway route`);
  }
  assert.match(proxy, /const ROUTE_SERVICE: Readonly<Record<string, ServiceName>>/);
  assert.match(proxy, /new URL\([\s\S]*config\.serviceUrls\[service\]/);
});

test("local bootstrap supports plain docker compose up", () => {
  const bootstrap = readFileSync(path.join(root, "scripts", "bootstrap-local.ps1"), "utf8");
  assert.match(bootstrap, /EDGE_HTTP_PORT = "8080"/);
  assert.match(bootstrap, /DISTRIBUTION_NODE_ENV = "development"/);
  assert.match(bootstrap, /docker compose up -d --build/);
});

test("local Compose rebuilds current source and supports bounded watch mode", () => {
  const watch = readFileSync(path.join(root, "scripts", "watch-local.ps1"), "utf8");
  assert.equal((compose.match(/pull_policy: build/g) ?? []).length, 29);
  for (const service of services) assert.match(block(service), /develop:\s+\*watch-/m, `${service} source watch`);
  for (const worker of ["catalog-import-worker", "catalog-saga-worker", "media-worker", "media-saga-worker", "distribution-worker", "distribution-saga-worker", "finance-worker", "notifications-worker", "analytics-worker", "audit-worker"]) {
    assert.match(block(worker), /develop:\s+\*watch-/m, `${worker} source watch`);
  }
  assert.match(watch, /COMPOSE_PARALLEL_LIMIT/);
  assert.match(watch, /docker compose up -d --build --watch/);
});

test("root Docker builds exclude unrelated and generated files", () => {
  const dockerignore = readFileSync(path.join(root, ".dockerignore"), "utf8");
  assert.match(dockerignore, /^\*\*\/node_modules$/m);
  assert.match(dockerignore, /^\*\*\/\.git$/m);
  assert.match(dockerignore, /^bealpha-upload-server$/m);
  assert.match(dockerignore, /^bealpha-dashboard$/m);

  const dashboardDockerignore = readFileSync(path.join(root, "bealpha-dashboard", ".dockerignore"), "utf8");
  assert.match(dashboardDockerignore, /^\.next\*$/m);
  assert.match(dashboardDockerignore, /^\*\.bak\.\*$/m);
  assert.match(dashboardDockerignore, /^\*\.bak$/m);
  assert.match(dashboardDockerignore, /^\*\.log$/m);
});

test("production builds do not emit application source maps", () => {
  for (const target of ["packages/contracts", ...services.map(service => `services/${service}`)]) {
    const tsconfig = JSON.parse(readFileSync(path.join(root, target, "tsconfig.json"), "utf8")) as {
      compilerOptions?: { sourceMap?: boolean; declarationMap?: boolean };
    };
    assert.notEqual(tsconfig.compilerOptions?.sourceMap, true, `${target} sourceMap`);
    assert.notEqual(tsconfig.compilerOptions?.declarationMap, true, `${target} declarationMap`);
  }

  const nextConfig = readFileSync(path.join(root, "bealpha-dashboard", "next.config.ts"), "utf8");
  assert.match(nextConfig, /productionBrowserSourceMaps:\s*false/);
  assert.match(nextConfig, /serverSourceMaps:\s*false/);

  const committedIps = [...nextConfig.matchAll(/\"((?:\d{1,3}\.){3}\d{1,3})\"/g)].map(match => match[1]);
  assert.deepEqual(committedIps.filter(ip => !["127.0.0.1", "0.0.0.0"].includes(ip)), [], "non-loopback dev IPs must come from DASHBOARD_DEV_ORIGINS");
});

test("edge exposes HTTP development access while HTTPS preserves configured tenant Hosts", () => {
  const nginx = readFileSync(path.join(root, "gateway", "nginx.conf"), "utf8");
  const edge = block("nginx");

  assert.match(nginx, /listen 8080 default_server;[\s\S]*?server_name _;[\s\S]*?location \/api\/ {[\s\S]*?proxy_pass http:\/\/gateway_backend;/);
  assert.match(nginx, /listen 8080 default_server;[\s\S]*?location \/ {[\s\S]*?proxy_pass http:\/\/dashboard_backend;/);
  assert.match(nginx, /listen 8443 ssl default_server;[\s\S]*?server_name \$\{EDGE_SERVER_NAMES\};/);
  assert.match(nginx, /server_name \$\{EDGE_SERVER_NAMES\};/);
  assert.match(nginx, /proxy_set_header Host \$host;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Host \$host;/);
  assert.doesNotMatch(nginx, /log_format[^;]*\$request[\s'"]/s, "access logs must not capture query strings or download capabilities");
  assert.match(nginx, /log_format main[\s\S]*\$request_method \$uri \$server_protocol/);
  assert.match(edge, /envsubst '\$\$\{EDGE_SERVER_NAMES\}'/);
  assert.match(edge, /nginx\.conf\.template/);
});

test("runtime service images remove dependency source maps after pruning", () => {
  for (const service of services) {
    const dockerfile = readFileSync(path.join(root, "services", service, "Dockerfile"), "utf8");
    assert.match(dockerfile, /find node_modules \/app\/packages\/contracts\/node_modules -type f -name '\*\.map' -delete/);
  }
});

test("ZIP and upload limits remain bounded", () => {
  assert.match(compose, /DISTRIBUTION_PACKAGE_MAX_BYTES[^\n]*53687091200/);
  assert.match(compose, /DISTRIBUTION_PACKAGE_MAX_ENTRIES[^\n]*10000/);
  assert.match(compose, /MEDIA_UPLOAD_MAX_BYTES[^\n]*53687091200/);
  assert.match(compose, /MEDIA_UPLOAD_CONCURRENCY[^\n]*4/);
});

test("runtime completion gate fails closed", () => {
  const verifier = readFileSync(path.join(root, "scripts", "verify-runtime.ps1"), "utf8");
  assert.match(verifier, /Missing microservice environment file/);
  assert.match(verifier, /Missing migration environment file/);
  assert.match(verifier, /AccessToken is required for authenticated smoke tests/);
  assert.match(verifier, /Missing migration verification report/);
  assert.match(verifier, /Migration verification report failed/);
});

test("production 2FA and SMTP security policy is explicit", () => {
  const identity = block("identity");
  const notificationsWorker = block("notifications-worker");

  for (const variable of [
    "IDENTITY_TOTP_ISSUER",
    "IDENTITY_TOTP_WINDOW",
    "IDENTITY_TOTP_STEP_SECONDS",
    "IDENTITY_TOTP_DIGITS",
    "IDENTITY_2FA_EMAIL_RATE_WINDOW_SECONDS",
  ]) {
    assert.match(identity, new RegExp(`${variable}:`), `${variable} identity environment`);
  }
  assert.match(notificationsWorker, /NOTIFICATION_REQUIRE_SMTP: ["']true["']/);
  assert.match(notificationsWorker, /SMTP_REQUIRE_TLS: \$\{SMTP_REQUIRE_TLS:-true\}/);
  assert.match(notificationsWorker, /SMTP_MESSAGE_ID_DOMAIN: \$\{SMTP_MESSAGE_ID_DOMAIN:\?SMTP_MESSAGE_ID_DOMAIN must be set\}/);
});

test("official DDEX schemas are pinned and resolved offline in every distribution runtime", () => {
  const envExamples = [".env.example", ".env.microservices.example"]
    .map((relative) => readFileSync(path.join(root, relative), "utf8"));
  const expected = new Map([
    ["ddex/official/ern-4.3.2/release-notification.xsd", "36110e2149336d35e90ea4822daca72961c121dcc6b5cf5b794048b50f6c1e8a"],
    ["ddex/official/ern-4.3.2/allowed-value-sets.xsd", "1725875b3de1da74fa483abfdefbe36bb7132e9f1d7b1124b710848ec48b125f"],
    ["ddex/official/ern-c-sftp-18.1/ern-choreography-sftp.xsd", "328305cc2c0626b4647dc2c833d6af632f8f292a30345b1602eadd9b07ebf3ac"],
    ["ddex/official/ern-c-sftp-18.1/allowed-value-sets.xsd", "1725875b3de1da74fa483abfdefbe36bb7132e9f1d7b1124b710848ec48b125f"],
    ["ddex/official/ern-c-sftp-18.1/xmldsig-core-schema.xsd", "35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c"],
  ]);
  for (const [relative, digest] of expected) {
    const bytes = readFileSync(path.join(root, relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, relative);
  }
  for (const source of envExamples) {
    assert.match(source, /DISTRIBUTION_ERN_XSD_HOST_DIR=.\/ddex\/official\/ern-4\.3\.2/);
    assert.match(source, /DISTRIBUTION_ACK_XSD_HOST_DIR=.\/ddex\/official\/ern-c-sftp-18\.1/);
  }
  for (const service of ["distribution", "distribution-worker", "distribution-saga-worker"]) {
    const source = block(service);
    assert.match(source, /NODE_ENV: \$\{DISTRIBUTION_NODE_ENV:-production\}/);
    assert.match(source, /XML_CATALOG_FILES: \/ddex\/ern\/catalog\.xml \/ddex\/ernc\/catalog\.xml/);
    assert.match(source, /DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES: \$\{DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES:-true\}/);
    assert.match(source, /DISTRIBUTION_SFTP_DELIVERY_ENABLED: \$\{DISTRIBUTION_SFTP_DELIVERY_ENABLED:-false\}/);
    assert.match(source, /DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID: \$\{DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID:\?DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID must be set\}/);
    assert.match(source, /:\/ddex\/ern:ro/);
    assert.match(source, /:\/ddex\/ernc:ro/);
  }
});

test("cutover and rollback scripts fail closed", () => {
  const cutover = readFileSync(path.join(root, "scripts", "cutover.ps1"), "utf8");
  const rollback = readFileSync(path.join(root, "scripts", "rollback.ps1"), "utf8");
  assert.match(cutover, /Required cutover file not found/);
  assert.ok(cutover.indexOf("if (-not $Execute)") < cutover.indexOf("Required cutover file not found"), "cutover dry-run must not require environment files");
  assert.match(cutover, /\[IO\.Path\]::IsPathRooted\(\$value\)/);
  assert.match(cutover, /MIGRATION_MAINTENANCE_CONFIRMED/);
  assert.match(cutover, /Migration verification failed; do not switch traffic/);
  assert.match(rollback, /ROLLBACK_DATABASE_URL must not target the legacy database/);
  assert.match(rollback, /\[IO\.Path\]::IsPathRooted\(\$BackupFile\)/);
  assert.match(rollback, /ROLLBACK_DATABASE_URL must target an empty recovery database/);
  assert.match(rollback, /SELECT count\(\*\) FROM pg_catalog\.pg_class/);
  assert.doesNotMatch(cutover, /docker\s+compose\s+down/);
  assert.doesNotMatch(rollback, /docker\s+compose\s+down/);
});
