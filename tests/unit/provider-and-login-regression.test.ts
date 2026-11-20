import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("provider and login regressions", () => {
  it("hydrates locale storage asynchronously and cleans up the scheduled update", () => {
    const provider = source("lib/i18n/I18nProvider.tsx");
    expect(provider).toContain("const hydrationTimer = window.setTimeout(() => {");
    expect(provider).toContain("return () => window.clearTimeout(hydrationTimer);");
    expect(provider).toContain("const nextLanguage = normalizeLocale(lang);");
    expect(provider).toContain('localStorage.setItem("bealpha_locale", nextLanguage);');
    expect(provider).not.toContain("eslint-disable-line react-hooks/exhaustive-deps");
  });

  it("applies themes without maintaining unused mount state", () => {
    const provider = source("components/ThemeProvider.tsx");
    expect(provider).toContain('root.setAttribute("data-theme", theme)');
    expect(provider).not.toContain("setMounted");
  });

  it("keeps only login state that contributes to authentication or rendering", () => {
    const login = source("app/login/page.tsx");
    expect(login).not.toMatch(/focusedField|isNewLocation|hardwareId|bealpha_hwid/);
    expect(login).toContain("deviceName,");
    expect(login).toContain("deviceType,");
  });
});
