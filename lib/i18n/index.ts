/**
 * Internationalization (i18n) + Currency Conversion System
 *
 * Supports 20 languages:
 * en, vi, ja, ko, zh, fr, es, de, pt, th,
 * ar, ru, it, nl, pl, tr, id, hi, sv, uk
 *
 * Auto-translates UI based on user's language setting.
 * Auto-converts currency display based on user's currency setting.
 */

import en from "./translations/en";
import vi from "./translations/vi";
import ja from "./translations/ja";
import ko from "./translations/ko";
import zh from "./translations/zh";
import fr from "./translations/fr";
import es from "./translations/es";
import de from "./translations/de";
import pt from "./translations/pt";
import th from "./translations/th";
import ar from "./translations/ar";
import ru from "./translations/ru";
import it from "./translations/it";
import nl from "./translations/nl";
import pl from "./translations/pl";
import tr from "./translations/tr";
import idLang from "./translations/id";
import hi from "./translations/hi";
import sv from "./translations/sv";
import uk from "./translations/uk";
import type { TranslationKeys } from "./translations/en";

export type { TranslationKeys };

// ── Types ────────────────────────────────────────────────
export type Locale =
  | "en"
  | "vi"
  | "ja"
  | "ko"
  | "zh"
  | "fr"
  | "es"
  | "de"
  | "pt"
  | "th"
  | "ar"
  | "ru"
  | "it"
  | "nl"
  | "pl"
  | "tr"
  | "id"
  | "hi"
  | "sv"
  | "uk";

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
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "" },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "" },
  { code: "fr", name: "French", nativeName: "Français", flag: "" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "" },
  { code: "th", name: "Thai", nativeName: "ไทย", flag: "" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "", dir: "rtl" },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "" },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "" },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "" },
  { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "" },
];

const dictionaries: Record<string, TranslationKeys> = {
  en, vi, ja, ko, zh, fr, es, de, pt, th,
  ar, ru, it, nl, pl, tr, id: idLang, hi, sv, uk,
};

// ── Translation helpers ──────────────────────────────────
export function getTranslation(lang: string): TranslationKeys {
  return dictionaries[lang] || dictionaries.en;
}

/**
 * Map a short locale code to a full BCP47 locale for Intl APIs.
 */
export const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  vi: "vi-VN",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  pt: "pt-BR",
  th: "th-TH",
  ar: "ar-SA",
  ru: "ru-RU",
  it: "it-IT",
  nl: "nl-NL",
  pl: "pl-PL",
  tr: "tr-TR",
  id: "id-ID",
  hi: "hi-IN",
  sv: "sv-SE",
  uk: "uk-UA",
};

// ── Currency Exchange Rates (against USD base) ──
// Approximate rates — in production, fetch from a real-time API
const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  VND: 25450,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  KRW: 1340,
  CNY: 7.24,
  THB: 35.8,
  AUD: 1.55,
  CAD: 1.36,
  SGD: 1.34,
  BRL: 5.05,
  SAR: 3.75,
  RUB: 92.5,
  INR: 83.5,
  IDR: 15700,
  PLN: 4.02,
  TRY: 32.5,
  SEK: 10.8,
  UAH: 41.5,
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  VND: "₫",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  KRW: "₩",
  CNY: "¥",
  THB: "฿",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  BRL: "R$",
  SAR: "﷼",
  RUB: "₽",
  INR: "₹",
  IDR: "Rp",
  PLN: "zł",
  TRY: "₺",
  SEK: "kr",
  UAH: "₴",
};

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  VND: 0,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KRW: 0,
  CNY: 2,
  THB: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  BRL: 2,
  SAR: 2,
  RUB: 2,
  INR: 2,
  IDR: 0,
  PLN: 2,
  TRY: 2,
  SEK: 2,
  UAH: 2,
};

/**
 * Convert a USD amount to a target currency.
 */
export function convertCurrency(amountUSD: number, toCurrency: string): number {
  const rate = EXCHANGE_RATES[toCurrency] || 1;
  return amountUSD * rate;
}

/**
 * Format a USD amount as a localized currency string.
 */
export function formatCurrency(amountUSD: number, currency: string): string {
  const converted = convertCurrency(amountUSD, currency);
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;

  if (decimals === 0) {
    return `${symbol}${Math.round(converted).toLocaleString()}`;
  }
  return `${symbol}${converted.toFixed(decimals)}`;
}

/**
 * Format currency with compact notation for large values.
 * e.g. $1.2M, ₫30.5B
 */
export function formatCurrencyCompact(
  amountUSD: number,
  currency: string,
): string {
  const converted = convertCurrency(amountUSD, currency);
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const abs = Math.abs(converted);

  if (abs >= 1_000_000_000)
    return `${symbol}${(converted / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)
    return `${symbol}${(converted / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${(converted / 1_000).toFixed(1)}K`;

  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return `${symbol}${converted.toFixed(decimals)}`;
}

/**
 * Get the exchange rate for display.
 */
export function getExchangeRate(currency: string): number {
  return EXCHANGE_RATES[currency] || 1;
}

/**
 * Get currency symbol.
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}
