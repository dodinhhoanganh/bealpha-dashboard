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
  type Locale,
  LOCALES,
} from "./index";

// ── Context interface ──
interface I18nContextValue {
  language: Locale;
  currency: string;
  setLanguage: (lang: Locale) => void;
  setCurrency: (cur: string) => void;
  t: (
    key: string,
    valuesOrFallback?: TranslationValues | string,
    fallback?: string,
  ) => string;
  locales: typeof LOCALES;
}

export type TranslationValues = Record<string, string | number>;

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Dot-path resolver ──
function resolvePath(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function interpolateTranslation(
  template: string,
  values: TranslationValues = {},
): string {
  return template.replace(
    /\{\{([A-Za-z0-9_]+)\}\}|\{([A-Za-z0-9_]+)\}/g,
    (placeholder, doubleBraceKey: string | undefined, singleBraceKey: string | undefined) => {
      const key = doubleBraceKey ?? singleBraceKey;
      return key && Object.hasOwn(values, key) ? String(values[key]) : placeholder;
    },
  );
}

function normalizeLocale(value: string | null | undefined): Locale {
  return LOCALES.some((locale) => locale.code === value) ? (value as Locale) : "en";
}

function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = LOCALES.find((item) => item.code === locale)?.dir || "ltr";
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
    normalizeLocale(initialLanguage),
  );
  const [currency, setCurrencyState] = useState(initialCurrency || "USD");

  const translations = useMemo(() => getTranslation(language), [language]);

  // Hydrate from localStorage for unauthenticated pages (e.g. login)
  useEffect(() => {
    const saved = normalizeLocale(localStorage.getItem("bealpha_locale") || initialLanguage);
    const savedCurrency = localStorage.getItem("bealpha_currency");
    applyDocumentLocale(saved);
    const hydrationTimer = window.setTimeout(() => {
      setLanguageState(saved);
      if (savedCurrency) setCurrencyState(savedCurrency);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, [initialLanguage]);

  const setLanguage = useCallback((lang: Locale) => {
    // Accept legacy profile values, but never activate a locale that is not
    // currently advertised as fully translated in the workbench.
    const nextLanguage = normalizeLocale(lang);
    setLanguageState(nextLanguage);
    if (typeof window !== "undefined") {
      localStorage.setItem("bealpha_locale", nextLanguage);
      applyDocumentLocale(nextLanguage);
    }
  }, []);

  const setCurrency = useCallback((cur: string) => {
    setCurrencyState(cur);
    if (typeof window !== "undefined") {
      localStorage.setItem("bealpha_currency", cur);
    }
  }, []);

  const t = useCallback(
    (
      key: string,
      valuesOrFallback?: TranslationValues | string,
      fallback?: string,
    ): string => {
      const values = typeof valuesOrFallback === "object" ? valuesOrFallback : undefined;
      const fallbackText = typeof valuesOrFallback === "string" ? valuesOrFallback : fallback;
      const result = resolvePath(translations, key);
      if (result) return interpolateTranslation(result, values);
      // Fallback to English
      if (language !== "en") {
        const enResult = resolvePath(getTranslation("en"), key);
        if (enResult) return interpolateTranslation(enResult, values);
      }
      return interpolateTranslation(fallbackText || key, values);
    },
    [translations, language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      currency,
      setLanguage,
      setCurrency,
      t,
      locales: LOCALES,
    }),
    [
      language,
      currency,
      setLanguage,
      setCurrency,
      t,
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
      t: (
        key: string,
        valuesOrFallback?: TranslationValues | string,
        fallback?: string,
      ) => {
        const values = typeof valuesOrFallback === "object" ? valuesOrFallback : undefined;
        const fallbackText = typeof valuesOrFallback === "string" ? valuesOrFallback : fallback;
        return interpolateTranslation(
          resolvePath(enTranslations, key) || fallbackText || key,
          values,
        );
      },
      locales: LOCALES,
    };
  }
  return ctx;
}
