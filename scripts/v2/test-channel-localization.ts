import assert from "node:assert/strict";
import { resolveChannelTitle } from "../../app/v2/channelTitle";
assert.equal(resolveChannelTitle("Forest", {}, "ru"), "Forest");
assert.equal(resolveChannelTitle("Forest", { ru: "Лес" }, "ru"), "Лес");
assert.equal(resolveChannelTitle("Forest", { en: "Forest" }, "ru"), "Forest");
assert.equal(resolveChannelTitle("Forest", { ru: "  ", en: "Forest" }, "ru"), "Forest");
assert.equal(resolveChannelTitle("Forest", { ko: "숲" }, "ru"), "Forest");
assert.equal(resolveChannelTitle(" ", {}, "en"), "Untitled channel");
console.info("V2 channel localization PASS: locale, English, default and safe fallback semantics.");
