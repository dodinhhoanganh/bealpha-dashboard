import assert from "node:assert/strict";
import test from "node:test";

import { configureWhiteLabel, parseConfig, type WhiteLabelConfig } from "../configure-white-label.js";

const config: WhiteLabelConfig = {
  platformBaseUrl: "https://platform.example.com",
  brand: {
    displayName: "Example Music",
    logoAssetId: null,
    accentColor: "#172554",
    accentTextColor: "#FFFFFF",
    supportEmail: null,
    supportUrl: null,
    defaultLocale: "vi"
  },
  hostname: "music.example.com"
};

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data, error: null }), {
  status,
  headers: { "content-type": "application/json" }
});

test("white-label sync is idempotent and never sends the token in URL or body", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/tenant-brand")) return ok({ ...config.brand, version: 7 });
    if (url.endsWith("/tenant-domains")) return ok([{ id: "domain-1", hostname: config.hostname, status: "VERIFIED", version: 2 }]);
    throw new Error(`Unexpected URL ${url}`);
  };
  const output: string[] = [];
  await configureWhiteLabel({ config, token: "secret-token", baseUrl: config.platformBaseUrl!, fetcher, output: line => output.push(line) });

  assert.deepEqual(requests.map(request => request.init.method ?? "GET"), ["GET", "GET"]);
  assert.ok(requests.every(request => !request.url.includes("secret-token") && !String(request.init.body ?? "").includes("secret-token")));
  assert.ok(output.every(line => !line.includes("secret-token")));
  assert.deepEqual(output, ["Brand: Example Music (unchanged)", "Domain: music.example.com (VERIFIED)"]);
});

test("dry-run reports changes without mutation", async () => {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    methods.push(init.method ?? "GET");
    if (String(input).endsWith("/tenant-brand")) return ok({ ...config.brand, displayName: "Old Name", version: 1 });
    return ok([]);
  };
  const output: string[] = [];
  await configureWhiteLabel({ config, token: "secret", baseUrl: config.platformBaseUrl!, dryRun: true, verify: true, fetcher, output: line => output.push(line) });
  assert.deepEqual(methods, ["GET", "GET"]);
  assert.deepEqual(output, [
    "DRY-RUN brand: would update Example Music",
    "DRY-RUN domain: would register music.example.com",
    "DRY-RUN verification: would request DNS verification after registration"
  ]);
});

test("first sync updates brand and registers the domain once", async () => {
  const methods: string[] = [];
  const output: string[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    methods.push(init.method ?? "GET");
    if (url.endsWith("/tenant-brand") && !init.method) return ok({ ...config.brand, displayName: "Old Name", version: 3 });
    if (url.endsWith("/tenant-brand") && init.method === "PATCH") return ok({ ...config.brand, version: 4 });
    if (url.endsWith("/tenant-domains") && !init.method) return ok([]);
    if (url.endsWith("/tenant-domains") && init.method === "POST") return ok({
      domain: { id: "domain-1", hostname: config.hostname, status: "PENDING", version: 1 },
      verification: { type: "TXT", name: "_bealpha-verification.music.example.com", value: "bealpha-verification=challenge" }
    }, 201);
    throw new Error(`Unexpected URL ${url}`);
  };
  await configureWhiteLabel({ config, token: "secret", baseUrl: config.platformBaseUrl!, fetcher, output: line => output.push(line) });
  assert.deepEqual(methods, ["GET", "PATCH", "GET", "POST"]);
  assert.deepEqual(output, [
    "Brand: Example Music (updated)",
    "DNS TXT: _bealpha-verification.music.example.com = bealpha-verification=challenge",
    "Domain: music.example.com (PENDING)"
  ]);
});

test("verify explicitly checks a pending domain and reports verified state", async () => {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    methods.push(init.method ?? "GET");
    if (url.endsWith("/tenant-brand")) return ok({ ...config.brand, version: 4 });
    if (url.endsWith("/tenant-domains")) return ok([{ id: "domain-1", hostname: config.hostname, status: "PENDING", version: 1 }]);
    if (url.endsWith("/tenant-domains/domain-1/verify")) return ok({ id: "domain-1", hostname: config.hostname, status: "VERIFIED", version: 2 });
    throw new Error(`Unexpected URL ${url}`);
  };
  const output: string[] = [];
  await configureWhiteLabel({ config, token: "secret", baseUrl: config.platformBaseUrl!, verify: true, fetcher, output: line => output.push(line) });
  assert.deepEqual(methods, ["GET", "GET", "POST"]);
  assert.equal(output.at(-1), "Domain: music.example.com (VERIFIED)");
});

test("configuration rejects secret fields instead of persisting credentials", async () => {
  assert.throws(() => parseConfig({ ...config, accessToken: "secret" }), /Unknown configuration field/);
  assert.equal(parseConfig({ ...config, hostname: "MÜSIC.Example.COM." }).hostname, "xn--msic-0ra.example.com");
  assert.throws(() => parseConfig({ ...config, hostname: "example.com:443" }), /Invalid hostname/);
  await assert.rejects(configureWhiteLabel({ config, token: "secret", baseUrl: "http://platform.example.com" }), /must use HTTPS/);
});
