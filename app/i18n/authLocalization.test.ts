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

test("login link confirmation uses short, account-independent copy", () => {
  assert.equal(en.authCheckEmailDescription, "We sent you a sign-in link.");
  assert.equal(ru.authCheckEmailTitle, "Проверьте почту");
  assert.equal(ru.authCheckEmailDescription, "Мы отправили вам ссылку для входа.");
  assert.equal(vi.authCheckEmailDescription, "Chúng tôi đã gửi cho bạn liên kết đăng nhập.");
  assert.equal(th.authCheckEmailDescription, "เราส่งลิงก์เข้าสู่ระบบให้คุณแล้ว");
  for (const dictionary of Object.values(dictionaries)) {
    assert.doesNotMatch(dictionary.authCheckEmailDescription, /{{|}}|email|e-mail/i);
  }
});
