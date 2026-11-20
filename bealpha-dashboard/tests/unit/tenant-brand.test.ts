import { brandCssTokens, DEFAULT_BRAND } from "@/lib/tenant-brand";

describe("tenant brand tokens", () => {
  it("uses an accessible fallback when the tenant brand cannot be loaded", () => {
    expect(DEFAULT_BRAND.accentColor).toBe("#111111");
    expect(DEFAULT_BRAND.accentTextColor).toBe("#FFFFFF");
  });

  it("maps a validated brand to semantic tokens without arbitrary CSS", () => {
    const tokens = brandCssTokens({ ...DEFAULT_BRAND, accentColor: "#112233", accentTextColor: "#FFFFFF" });
    expect(tokens["--accent"]).toBe("#112233");
    expect(tokens["--accent-contrast"]).toBe("#FFFFFF");
    expect(Object.keys(tokens)).toEqual(expect.arrayContaining(["--accent-hover", "--accent-surface"]));
  });
});
