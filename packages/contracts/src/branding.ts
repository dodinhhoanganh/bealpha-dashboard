import { z } from "zod";

const hostnameLabel = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeTenantHostname(input: string): string {
  const raw = input.trim();
  if (!raw || raw.length > 253 || /[\s/:@?#]/.test(raw)) throw new Error("Invalid tenant hostname");
  let hostname: string;
  try {
    hostname = new URL(`https://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("Invalid tenant hostname");
  }
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some(label => !hostnameLabel.test(label)) || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    throw new Error("Invalid tenant hostname");
  }
  return hostname;
}

export function tenantDomainCacheKey(hostname: string): string {
  return `gateway:tenant-domain:${normalizeTenantHostname(hostname)}`;
}

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform(value => value.toUpperCase());

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (bright! + 0.05) / (dark! + 0.05);
}

const tenantBrandFields = {
  displayName: z.string().trim().min(2).max(80),
  logoAssetId: z.string().uuid().nullable().optional(),
  accentColor: hexColorSchema,
  accentTextColor: hexColorSchema,
  supportEmail: z.string().trim().email().max(254).toLowerCase().nullable().optional(),
  supportUrl: z.string().url().max(2048).refine(value => new URL(value).protocol === "https:").nullable().optional(),
  defaultLocale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).default("en")
};

function validateContrast(value: { accentColor: string; accentTextColor: string }, ctx: z.RefinementCtx) {
  if (contrast(value.accentColor, value.accentTextColor) < 4.5) {
    ctx.addIssue({ code: "custom", path: ["accentTextColor"], message: "Brand colors must meet WCAG AA contrast" });
  }
}

export const tenantBrandUpdateSchema = z.object({
  ...tenantBrandFields,
  expectedVersion: z.number().int().positive()
}).strict().superRefine(validateContrast);

export const tenantBrandSchema = z.object({
  ...tenantBrandFields,
  tenantId: z.string().uuid(),
  logoUrl: z.string().max(2048).nullable(),
  version: z.number().int().positive()
}).strict().superRefine(validateContrast);

export type TenantBrandUpdate = z.infer<typeof tenantBrandUpdateSchema>;
export type TenantBrand = z.infer<typeof tenantBrandSchema>;

export const tenantDomainStatusSchema = z.enum(["PENDING", "VERIFIED"]);

export const tenantDomainCreateSchema = z.object({
  hostname: z.string().trim().min(4).max(253).transform((value, ctx) => {
    try { return normalizeTenantHostname(value); }
    catch { ctx.addIssue({ code: "custom", message: "Invalid tenant hostname" }); return z.NEVER; }
  })
}).strict();

export const tenantDomainMutationSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

export const tenantDomainSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  hostname: z.string().min(4).max(253),
  status: tenantDomainStatusSchema,
  version: z.number().int().positive(),
  verifiedAt: z.string().datetime().nullable(),
  lastCheckedAt: z.string().datetime().nullable()
}).strict();

export const resolvedTenantDomainSchema = z.object({
  tenantId: z.string().uuid(),
  hostname: z.string().min(4).max(253),
  version: z.number().int().positive()
}).strict();

export type TenantDomain = z.infer<typeof tenantDomainSchema>;
export type ResolvedTenantDomain = z.infer<typeof resolvedTenantDomainSchema>;
