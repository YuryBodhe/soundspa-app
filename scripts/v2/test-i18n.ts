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
console.info("V2 i18n dictionaries/locales PASS: supported locales, browser hints, typed dictionary completeness.");
