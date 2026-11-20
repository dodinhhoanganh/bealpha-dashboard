import { describe, expect, it, vi } from "vitest";
import { exportSPKI, generateKeyPair } from "jose";
import type { FastifyInstance } from "fastify";

// Runtime boundary imports keep each service's source/typecheck compilation isolated.
type AppBuilder = (options: { config: unknown; service: unknown; logger: boolean }) => Promise<FastifyInstance>;
type ConfigLoader = (env: NodeJS.ProcessEnv) => unknown;
type ErrorConstructor = new (status: number, code: string, message: string) => Error;
const mediaRoot = ["..", "..", "media", "src"].join("/");
const financeRoot = ["..", "..", "finance", "src"].join("/");
const { buildMediaApp } = await import(process.env.MEDIA_LOG_TEST_SOURCE ?? `${mediaRoot}/app.js`) as { buildMediaApp: AppBuilder };
const { buildFinanceApp } = await import(process.env.FINANCE_LOG_TEST_SOURCE ?? `${financeRoot}/app.js`) as { buildFinanceApp: AppBuilder };
const { loadMediaConfig } = await import(`${mediaRoot}/config.js`) as { loadMediaConfig: ConfigLoader };
const { loadFinanceConfig } = await import(`${financeRoot}/config.js`) as { loadFinanceConfig: ConfigLoader };
const { MediaError } = await import(`${mediaRoot}/errors.js`) as { MediaError: ErrorConstructor };
const { FinanceError } = await import(`${financeRoot}/errors.js`) as { FinanceError: ErrorConstructor };
const keys = await generateKeyPair("ES256", { extractable: true });
const pem = await exportSPKI(keys.publicKey);
const env = { NODE_ENV: "test", TRUST_PROXY_HOPS: "0", LOG_LEVEL: "info", GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64: pem.replace(/-----(?:BEGIN|END) PUBLIC KEY-----|\s/g, ""), MEDIA_DATABASE_URL: "postgresql://fixture:fixture@localhost/media", FINANCE_DATABASE_URL: "postgresql://fixture:fixture@localhost/finance" };
const id = "10000000-0000-4000-8000-000000000001";
const secret = "fixture-capability-secret".repeat(3);
const otherSecret = "fixture-query-signature";
const headerSecret = "fixture-internal-header";

describe.each(["media", "finance"] as const)("%s native request-log redaction", kind => {
  it.each(["health", "data"] as const)("keeps useful %s request logs without query capabilities", async route => {
    const app = kind === "media"
      ? await buildMediaApp({ config: loadMediaConfig(env), service: { openStream: vi.fn(async () => { throw new MediaError(401, "INVALID_STREAM_TOKEN", "Invalid stream token"); }) } as never, logger: true })
      : await buildFinanceApp({ config: loadFinanceConfig(env), service: { receiveUpload: vi.fn(async () => { throw new FinanceError(401, "INVALID_UPLOAD_TOKEN", "Invalid upload token"); }) } as never, logger: true });
    const streamKey = Object.getOwnPropertySymbols(app.log).find(symbol => symbol.description === "pino.stream");
    if (!streamKey) throw new Error("Pino log sink not found");
    const sink = Reflect.get(app.log, streamKey) as { write(chunk: string): boolean };
    const logs: string[] = [];
    const capture = vi.spyOn(sink, "write").mockImplementation(chunk => { logs.push(String(chunk)); return true; });
    try {
      const pathname = route === "health" ? "/health/live" : kind === "media" ? `/media-stream/${id}` : `/finance-upload/${id}`;
      const url = `${pathname}?token=${secret}&signature=${otherSecret}`;
      const requestId = "20000000-0000-4000-8000-000000000001";
      const headers = { "x-request-id": requestId, "x-bealpha-context": headerSecret };
      const result = kind === "finance" && route === "data"
        ? await app.inject({ method: "PUT", url, headers: { ...headers, "content-type": "text/csv", "content-length": "4" }, payload: "row\n" })
        : await app.inject({ method: "GET", url, headers });
      expect(result.statusCode).toBe(route === "health" ? 200 : 401);
      await app.close();
      const output = logs.join("");
      expect(output).not.toContain(secret);
      expect(output).not.toContain(otherSecret);
      expect(output).not.toContain(headerSecret);
      const records = logs.flatMap(line => line.trim().split("\n")).filter(Boolean).map(line => JSON.parse(line) as { reqId?: string; req?: { method?: string; url?: string }; res?: { statusCode?: number } });
      expect(records.some(record => record.reqId === requestId && record.req?.url === pathname && record.req.method === (kind === "finance" && route === "data" ? "PUT" : "GET"))).toBe(true);
      expect(records.some(record => record.res?.statusCode === result.statusCode)).toBe(true);
    } finally {
      await app.close();
      capture.mockRestore();
    }
  });
});
