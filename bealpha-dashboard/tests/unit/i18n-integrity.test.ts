import fs from "node:fs";
import path from "node:path";
import { interpolateTranslation } from "@/lib/i18n/I18nProvider";
import { LOCALES } from "@/lib/i18n";
import en from "@/lib/i18n/translations/en";
import vi from "@/lib/i18n/translations/vi";

const translationsDir = path.join(process.cwd(), "lib", "i18n", "translations");
const forbidden = [
  /MYMEMORY WARNING/i,
  /mymemory\.translated\.net/i,
  /api\.mymemory/i,
  /usagelimits\.php/i,
];

function leafEntries(value: unknown, prefix = ""): Array<[string, string]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof nested === "string" ? [[path, nested]] : leafEntries(nested, path);
  });
}

describe("translation source integrity", () => {
  it("contains no external translation quota responses or MyMemory endpoints", () => {
    const violations = fs.readdirSync(translationsDir)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => {
        const source = fs.readFileSync(path.join(translationsDir, file), "utf8");
        return forbidden
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${file}: ${pattern.source}`);
      });

    expect(violations).toEqual([]);
  });

  it("does not contain hard-coded or approximate exchange-rate data", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib", "i18n", "index.ts"), "utf8");

    expect(source).not.toMatch(/EXCHANGE_RATES|Approximate rates|convertCurrency/);
  });

  it("keeps the English and Vietnamese dictionaries complete and non-empty", () => {
    const english = leafEntries(en);
    const vietnamese = leafEntries(vi);

    expect(vietnamese.map(([key]) => key).sort()).toEqual(english.map(([key]) => key).sort());
    expect(english.every(([, value]) => value.trim().length > 0)).toBe(true);
    expect(vietnamese.every(([, value]) => value.trim().length > 0)).toBe(true);
  });

  it("advertises only fully supported workbench locales", () => {
    expect(LOCALES.map(({ code }) => code)).toEqual(["en", "vi"]);
    expect(LOCALES.every(({ code }) => code === "en" || code === "vi")).toBe(true);
  });

  it("uses the approved Vietnamese organization terminology", () => {
    expect(vi.entities).toMatchObject({
      title: "Cấu trúc tổ chức",
      systemAdmin: "Đội vận hành BeAlpha",
      organization: "Tổ chức khách hàng",
      subAccount: "Tài khoản trực thuộc",
      tenant: "Tổ chức khách hàng",
      parentTenant: "Tổ chức cấp trên",
      reviewer: "Người duyệt bản phát hành",
    });
    expect(Object.values(vi.entities)).not.toContain("Người thuê nhà");
  });

  it("keeps technical hierarchy jargon out of organization-facing copy", () => {
    const englishCopy = leafEntries({ entities: en.entities, users: en.users }).map(([, value]) => value).join("\n");
    const vietnameseCopy = leafEntries({ entities: vi.entities, users: vi.users }).map(([, value]) => value).join("\n");
    expect(englishCopy).not.toMatch(/\b(?:tenant|entity|b2b2b|rbac)\b/i);
    expect(vietnameseCopy).not.toMatch(/tenant|thực thể|b2b2b|rbac/i);
  });

  it("interpolates translated domain values without leaking placeholders", () => {
    expect(interpolateTranslation(vi.form.totalShareValidation, { percentage: "75.25" }))
      .toBe("Tổng tỷ lệ là 75.25% (phải bằng đúng 100%).");
    expect(interpolateTranslation("Unknown {value}")).toBe("Unknown {value}");
  });

  it("defines every literal translation key used by the core workbench", () => {
    const englishKeys = new Set(leafEntries(en).map(([key]) => key));
    const files = [
      "components/dashboard/DashboardPanel.tsx",
      "components/entities/EntitiesPanel.tsx",
      "components/entities/EntityTreeView.tsx",
      "components/entities/UsersPanel.tsx",
      "components/releases/TrackForm.tsx",
    ];
    const missing = files.flatMap((relativePath) => {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      return [...source.matchAll(/\bt\(\s*["'`]([^"'`]+)["'`]/g)]
        .map((match) => match[1]!)
        .filter((key) => !englishKeys.has(key))
        .map((key) => `${relativePath}: ${key}`);
    });

    expect(missing).toEqual([]);
  });
});
