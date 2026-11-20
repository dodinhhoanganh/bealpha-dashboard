/**
 * Internationalization (i18n) + Currency Conversion System
 *
 * The workbench currently advertises only the two complete UI locales:
 * English and Vietnamese. Unsupported legacy language values normalize to
 * English instead of loading incomplete dictionaries.
 * Auto-converts currency display based on user's currency setting.
 */

import en from "./translations/en";
import vi from "./translations/vi";
import type { LocaleDictionary, TranslationKeys } from "./translations/en";

export type { LocaleDictionary, TranslationKeys };

// ── Types ────────────────────────────────────────────────
export type Locale = "en" | "vi";

export interface LocaleInfo {
  code: Locale;
  name: string;
  nativeName: string;
  flag: string;
  dir?: "ltr" | "rtl";
}

// ── Supported Locales ────────────────────────────────────
export const LOCALES: LocaleInfo[] = [
  { code: "en", name: "English", nativeName: "English", flag: "" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "" },
];

const dictionaries: Record<Locale, LocaleDictionary> = {
  en,
  vi,
};

// ── Translation helpers ──────────────────────────────────
export function getTranslation(lang: string): LocaleDictionary {
  return dictionaries[lang as Locale] || dictionaries.en;
}
