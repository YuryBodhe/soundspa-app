"use client";
import { useI18n } from "@/app/i18n/I18nProvider";

export function AuthLanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return <label className="customer-auth-language">{t("language")} <select value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)} aria-label={t("selectLanguage")}>
    <option value="en">EN</option><option value="ru">RU</option><option value="vi">VI</option><option value="th">TH</option>
  </select></label>;
}
