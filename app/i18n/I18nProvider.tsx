"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { browserLocale, isLocale, localeStorageKey } from "./locales";
import { en } from "./dictionaries/en";
import { ru } from "./dictionaries/ru";
import { vi } from "./dictionaries/vi";
import { th } from "./dictionaries/th";
import type { Locale, TranslationKey } from "./types";

const dictionaries = { en, ru, vi, th } as const;
type I18nValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: TranslationKey) => string };
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    const persisted = window.localStorage.getItem(localeStorageKey);
    const initial = isLocale(persisted) ? persisted : browserLocale(window.navigator.language) ?? "en";
    setLocaleState(initial);
  }, []);
  const setLocale = (next: Locale) => { setLocaleState(next); window.localStorage.setItem(localeStorageKey, next); };
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key) => dictionaries[locale][key] ?? en[key] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() { const value = useContext(I18nContext); if (!value) throw new Error("useI18n must be used inside I18nProvider"); return value; }
