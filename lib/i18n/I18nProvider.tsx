"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  getTranslation,
  formatCurrency as fmtCurrency,
  formatCurrencyCompact as fmtCurrencyCompact,
  convertCurrency,
  getCurrencySymbol,
  type Locale,
  LOCALES,
} from "./index";
import type { TranslationKeys } from "./translations/en";

// ── Nested key path utility ──
type NestedKeyOf<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? NestedKeyOf<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>
        : Prefix extends ""
          ? K
          : `${Prefix}.${K}`;
    }[keyof T & string]
  : never;

type TranslationKey = NestedKeyOf<TranslationKeys>;

// ── Context interface ──
interface I18nContextValue {
  language: Locale;
  currency: string;
  setLanguage: (lang: Locale) => void;
  setCurrency: (cur: string) => void;
  t: (key: string, fallback?: string) => string;
  formatMoney: (amountUSD: number) => string;
  formatMoneyCompact: (amountUSD: number) => string;
  currencySymbol: string;
  locales: typeof LOCALES;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Dot-path resolver ──
function resolvePath(obj: any, path: string): string | undefined {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

// ── Provider ──
export function I18nProvider({
  children,
  initialLanguage = "en",
  initialCurrency = "USD",
}: {
  children: React.ReactNode;
  initialLanguage?: string;
  initialCurrency?: string;
}) {
  const [language, setLanguageState] = useState<Locale>(
    (initialLanguage || "en") as Locale,
  );
  const [currency, setCurrencyState] = useState(initialCurrency || "USD");

  const translations = useMemo(() => getTranslation(language), [language]);

  // Hydrate from localStorage for unauthenticated pages (e.g. login)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("bealpha_locale") as Locale | null;
      if (saved && saved !== language) {
        setLanguageState(saved);
        document.documentElement.lang = saved;
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setLanguage = useCallback((lang: Locale) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      localStorage.setItem("bealpha_locale", lang);
      // Also update the <html> lang attribute
      document.documentElement.lang = lang;
    }
  }, []);

  const setCurrency = useCallback((cur: string) => {
    setCurrencyState(cur);
    if (typeof window !== "undefined") {
      localStorage.setItem("bealpha_currency", cur);
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const result = resolvePath(translations, key);
      if (result) return result;
      // Fallback to English
      if (language !== "en") {
        const enResult = resolvePath(getTranslation("en"), key);
        if (enResult) return enResult;
      }
      return fallback || key;
    },
    [translations, language],
  );

  const formatMoney = useCallback(
    (amountUSD: number) => {
      return fmtCurrency(amountUSD, currency);
    },
    [currency],
  );

  const formatMoneyCompact = useCallback(
    (amountUSD: number) => {
      return fmtCurrencyCompact(amountUSD, currency);
    },
    [currency],
  );

  const currencySymbol = useMemo(() => getCurrencySymbol(currency), [currency]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      currency,
      setLanguage,
      setCurrency,
      t,
      formatMoney,
      formatMoneyCompact,
      currencySymbol,
      locales: LOCALES,
    }),
    [
      language,
      currency,
      setLanguage,
      setCurrency,
      t,
      formatMoney,
      formatMoneyCompact,
      currencySymbol,
    ],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ── Hook ──
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Provide a safe fallback so it works even outside provider (SSR, etc.)
    const enTranslations = getTranslation("en");
    return {
      language: "en" as Locale,
      currency: "USD",
      setLanguage: () => {},
      setCurrency: () => {},
      t: (key: string, fallback?: string) =>
        resolvePath(enTranslations, key) || fallback || key,
      formatMoney: (amount: number) => fmtCurrency(amount, "USD"),
      formatMoneyCompact: (amount: number) => fmtCurrencyCompact(amount, "USD"),
      currencySymbol: "$",
      locales: LOCALES,
    };
  }
  return ctx;
}

// Helper to resolve path outside context
function resolvePath2(obj: any, path: string): string | undefined {
  return resolvePath(obj, path);
}
