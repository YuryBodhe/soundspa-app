export type Locale = "en" | "ru" | "vi" | "th";
export type TranslationKey = keyof typeof import("./dictionaries/en").en;
export type Dictionary = Record<TranslationKey, string>;
