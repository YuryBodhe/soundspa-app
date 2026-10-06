import type { Locale } from "./types";
export const supportedLocales: readonly Locale[] = ["en", "ru", "vi", "th"];
export const localeStorageKey = "soundspa.v2.locale";
export function isLocale(value: unknown): value is Locale { return typeof value === "string" && (supportedLocales as readonly string[]).includes(value); }
export function browserLocale(value: string | undefined): Locale | null {
  const code = value?.toLowerCase().split("-")[0];
  return isLocale(code) ? code : null;
}
