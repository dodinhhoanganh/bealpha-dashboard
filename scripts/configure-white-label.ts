import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

type BrandConfig = {
  displayName: string;
  logoAssetId?: string | null;
  accentColor: string;
  accentTextColor: string;
  supportEmail?: string | null;
  supportUrl?: string | null;
  defaultLocale?: string;
};

export type WhiteLabelConfig = { platformBaseUrl?: string; brand: BrandConfig; hostname?: string };
type CurrentBrand = BrandConfig & { version: number };
type Domain = { id: string; hostname: string; status: "PENDING" | "VERIFIED"; version: number };
type Envelope<T> = { data: T; error: null };
type Fetcher = typeof fetch;

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`${status} ${code}`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requiredString(value, field);
}

function normalizeHostname(value: unknown): string {
  const raw = requiredString(value, "hostname");
  if (raw.length > 253 || /[\s/:@?#]/.test(raw)) throw new Error("Invalid hostname");
  const hostname = new URL(`https://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some(label => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)) || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    throw new Error("Invalid hostname");
  }
  return hostname;
}

export function parseConfig(value: unknown): WhiteLabelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuration must be a JSON object");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["platformBaseUrl", "brand", "hostname"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`Unknown configuration field: ${key}`);
  if (!raw.brand || typeof raw.brand !== "object" || Array.isArray(raw.brand)) throw new Error("Invalid brand");
  const brandRaw = raw.brand as Record<string, unknown>;
  const brandAllowed = new Set(["displayName", "logoAssetId", "accentColor", "accentTextColor", "supportEmail", "supportUrl", "defaultLocale"]);
  for (const key of Object.keys(brandRaw)) if (!brandAllowed.has(key)) throw new Error(`Unknown brand field: ${key}`);
  const color = (field: string) => {
    const result = requiredString(brandRaw[field], `brand.${field}`).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(result)) throw new Error(`Invalid brand.${field}`);
    return result;
  };
  const config: WhiteLabelConfig = {
    brand: {
      displayName: requiredString(brandRaw.displayName, "brand.displayName"),
      accentColor: color("accentColor"),
      accentTextColor: color("accentTextColor"),
      defaultLocale: brandRaw.defaultLocale === undefined ? "en" : requiredString(brandRaw.defaultLocale, "brand.defaultLocale"),
    }
  };
  for (const field of ["logoAssetId", "supportEmail", "supportUrl"] as const) {
    const parsed = optionalNullableString(brandRaw[field], `brand.${field}`);
    if (parsed !== undefined) config.brand[field] = parsed;
  }
  if (config.brand.supportEmail) config.brand.supportEmail = config.brand.supportEmail.toLowerCase();
  if (raw.platformBaseUrl !== undefined) config.platformBaseUrl = requiredString(raw.platformBaseUrl, "platformBaseUrl");
  if (raw.hostname !== undefined) config.hostname = normalizeHostname(raw.hostname);
  return config;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("platformBaseUrl must use HTTPS (HTTP is allowed only for localhost)");
  if (url.username || url.password || url.search || url.hash) throw new Error("platformBaseUrl must not contain credentials, query or fragment");
  return url.toString();
}

function sameBrand(current: CurrentBrand, desired: BrandConfig): boolean {
  return (Object.keys(desired) as Array<keyof BrandConfig>).every(key => current[key] === desired[key]);
}

export async function configureWhiteLabel(options: {
  config: WhiteLabelConfig;
  token: string;
  baseUrl: string;
  dryRun?: boolean;
  verify?: boolean;
  fetcher?: Fetcher;
  output?: (line: string) => void;
}): Promise<void> {
  const { config, token, dryRun = false, verify = false, fetcher = fetch, output = line => process.stdout.write(`${line}\n`) } = options;
  const desiredBrand: BrandConfig = {
    ...config.brand,
    logoAssetId: config.brand.logoAssetId ?? null,
    supportEmail: config.brand.supportEmail ?? null,
    supportUrl: config.brand.supportUrl ?? null,
    defaultLocale: config.brand.defaultLocale ?? "en"
  };
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const endpoint = (path: string) => new URL(`/api/v1${path}`, baseUrl).toString();
  const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await fetcher(endpoint(path), { ...init, headers, redirect: "error" });
    const body = await response.json().catch(() => null) as Envelope<T> | { error?: { code?: string } } | null;
    if (!response.ok || !body || !("data" in body)) {
      throw new ApiError(response.status, body && "error" in body ? body.error?.code ?? "REQUEST_FAILED" : "REQUEST_FAILED");
    }
    return body.data;
  };

  let brandChanged = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await api<CurrentBrand>("/catalog/tenant-brand");
    if (sameBrand(current, desiredBrand)) break;
    if (dryRun) {
      output(`DRY-RUN brand: would update ${config.brand.displayName}`);
      break;
    }
    try {
      await api("/catalog/tenant-brand", { method: "PATCH", body: JSON.stringify({ ...desiredBrand, expectedVersion: current.version }) });
      brandChanged = true;
      break;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || attempt === 1) throw error;
    }
  }
  if (!dryRun) output(`Brand: ${config.brand.displayName} (${brandChanged ? "updated" : "unchanged"})`);

  if (!config.hostname) return;
  let domains = await api<Domain[]>("/catalog/tenant-domains");
  let domain = domains.find(item => item.hostname === config.hostname);
  if (!domain && dryRun) {
    output(`DRY-RUN domain: would register ${config.hostname}`);
    if (verify) output("DRY-RUN verification: would request DNS verification after registration");
    return;
  }
  if (!domain) {
    try {
      const created = await api<{ domain: Domain; verification: { type: "TXT"; name: string; value: string } }>("/catalog/tenant-domains", {
        method: "POST",
        body: JSON.stringify({ hostname: config.hostname })
      });
      domain = created.domain;
      output(`DNS ${created.verification.type}: ${created.verification.name} = ${created.verification.value}`);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      domains = await api<Domain[]>("/catalog/tenant-domains");
      domain = domains.find(item => item.hostname === config.hostname);
      if (!domain) throw error;
    }
  }
  if (verify && domain.status !== "VERIFIED") {
    if (dryRun) output(`DRY-RUN verification: would verify ${domain.hostname}`);
    else domain = await api<Domain>(`/catalog/tenant-domains/${domain.id}/verify`, { method: "POST", body: JSON.stringify({ expectedVersion: domain.version }) });
  }
  output(`Domain: ${domain.hostname} (${domain.status})`);
}

function parseArgs(args: string[]) {
  const flags = new Set(args.filter(arg => arg.startsWith("--")));
  const paths = args.filter(arg => !arg.startsWith("--"));
  for (const flag of flags) if (flag !== "--dry-run" && flag !== "--verify") throw new Error(`Unknown option: ${flag}`);
  if (paths.length > 1) throw new Error("Provide exactly one configuration path");
  return { configPath: paths[0] ?? process.env.WHITE_LABEL_CONFIG, dryRun: flags.has("--dry-run"), verify: flags.has("--verify") || process.env.WHITE_LABEL_VERIFY === "true" };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { configPath, dryRun, verify } = parseArgs(args);
  const token = process.env.WHITE_LABEL_ACCESS_TOKEN;
  if (!configPath || !token) throw new Error("Configuration path and WHITE_LABEL_ACCESS_TOKEN are required");
  const config = parseConfig(JSON.parse(await readFile(configPath, "utf8")));
  const baseUrl = process.env.WHITE_LABEL_BASE_URL ?? config.platformBaseUrl;
  if (!baseUrl) throw new Error("platformBaseUrl or WHITE_LABEL_BASE_URL is required");
  await configureWhiteLabel({ config, token, baseUrl, dryRun, verify });
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch(error => {
    const token = process.env.WHITE_LABEL_ACCESS_TOKEN;
    const message = error instanceof Error ? error.message : "WHITE_LABEL_CONFIGURATION_FAILED";
    process.stderr.write(`${token ? message.replaceAll(token, "[REDACTED]") : message}\n`);
    process.exitCode = 1;
  });
}
