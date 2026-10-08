import assert from "node:assert/strict";
import { browserLocale, isLocale, supportedLocales } from "../../app/i18n/locales";
import { en } from "../../app/i18n/dictionaries/en";
import { ru } from "../../app/i18n/dictionaries/ru";
import { vi } from "../../app/i18n/dictionaries/vi";
import { th } from "../../app/i18n/dictionaries/th";

assert.deepEqual(supportedLocales, ["en", "ru", "vi", "th"]);
assert(isLocale("en") && isLocale("ru") && isLocale("vi") && isLocale("th"));
assert(!isLocale("de") && !isLocale(null));
assert.equal(browserLocale("ru-RU"), "ru"); assert.equal(browserLocale("th"), "th"); assert.equal(browserLocale("de-DE"), null);
for (const dictionary of [ru, vi, th]) for (const key of Object.keys(en) as Array<keyof typeof en>) assert.equal(typeof dictionary[key], "string", `missing ${key}`);
assert.equal(en.playingTrack, "Playing track");
assert.equal(en.standard, "Standard"); assert.equal(ru.standard, "Стандартный"); assert.equal(vi.standard, "Tiêu chuẩn"); assert.equal(th.standard, "มาตรฐาน");
assert.equal(ru.authSignupCheckEmailDescription, "Мы отправили письмо со ссылкой для подтверждения на указанный email. Откройте письмо и перейдите по ссылке, чтобы продолжить регистрацию.");
for (const dictionary of [en, ru, vi, th]) assert.ok(dictionary.authSignupCheckEmailDescription.length > 0);
console.info("V2 i18n dictionaries/locales PASS: supported locales, browser hints, typed dictionary completeness.");
