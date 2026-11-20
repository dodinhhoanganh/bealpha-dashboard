export interface TenantBrand {
  tenantId: string;
  displayName: string;
  logoAssetId: string | null;
  logoUrl: string | null;
  accentColor: string;
  accentTextColor: string;
  supportEmail: string | null;
  supportUrl: string | null;
  defaultLocale: string;
  version: number;
}

export const TENANT_BRAND_UPDATED_EVENT = "bealpha:tenant-brand-updated";

export const DEFAULT_BRAND: TenantBrand = {
  tenantId: "00000000-0000-4000-8000-000000000000",
  displayName: "BeAlpha Music",
  logoAssetId: null,
  logoUrl: null,
  accentColor: "#111111",
  accentTextColor: "#FFFFFF",
  supportEmail: null,
  supportUrl: null,
  defaultLocale: "en",
  version: 1,
};

export function brandCssTokens(brand: TenantBrand): Record<string, string> {
  return {
    "--accent": brand.accentColor,
    "--accent-hover": `color-mix(in srgb, ${brand.accentColor} 82%, black)`,
    "--accent-muted": `color-mix(in srgb, ${brand.accentColor} 65%, black)`,
    "--accent-surface": `color-mix(in srgb, ${brand.accentColor} 12%, transparent)`,
    "--accent-surface-hover": `color-mix(in srgb, ${brand.accentColor} 18%, transparent)`,
    "--accent-contrast": brand.accentTextColor,
  };
}
