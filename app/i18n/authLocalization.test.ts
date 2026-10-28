import assert from "node:assert/strict";
import test from "node:test";
import { en } from "./dictionaries/en";
import { ru } from "./dictionaries/ru";
import { vi } from "./dictionaries/vi";
import { th } from "./dictionaries/th";

const dictionaries = { en, ru, vi, th };
const requiredKeys = [
  "language", "selectLanguage", "authLoginTitle", "authLoginDescription", "authEmail", "authRequestLogin", "authSending", "authInvalidLink", "authInvalidEmail",
  "deviceActivationEyebrow", "deviceActivationConfirmTitle", "deviceActivationOrganization", "deviceActivationLocation", "deviceActivationDevice", "deviceActivationUnnamed", "deviceActivationSubmit", "deviceActivationUnavailableTitle", "deviceActivationUnavailableDescription", "deviceActivationTemporaryError",
] as const;

test("login and device activation copy is present in all supported locales", () => {
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const key of requiredKeys) assert.ok(dictionary[key].trim(), `${locale}.${key} is translated`);
  }
});
