import assert from "node:assert/strict";
import {
  AUTH_TOKEN_TTL_MS, CUSTOMER_SESSION_TTL_MS, SIGNUP_INTENT_TTL_MS,
  allowAuthRequest, authResponseHeaders, newHashedOpaqueToken, normalizeCustomerEmail, resolveAuthLocale, sha256,
} from "../../lib/v2/customerAuthCore";
import { renderCustomerAuthEmail } from "../../lib/v2/customerAuthEmails";
import { en } from "../../app/i18n/dictionaries/en";
import { ru } from "../../app/i18n/dictionaries/ru";
import { vi } from "../../app/i18n/dictionaries/vi";
import { th } from "../../app/i18n/dictionaries/th";

assert.equal(normalizeCustomerEmail("  USER+tag@Example.COM "), "user+tag@example.com");
assert.equal(normalizeCustomerEmail("invalid"), null);
assert.equal(resolveAuthLocale("vi", "ru-RU, en;q=0.8"), "vi");
assert.equal(resolveAuthLocale(null, "ru-RU, en;q=0.8"), "ru");
assert.equal(resolveAuthLocale("fr", "fr-FR"), "en");

const auth = newHashedOpaqueToken();
assert.match(auth.token, /^[A-Za-z0-9_-]{43}$/);
assert.match(auth.tokenHash, /^[0-9a-f]{64}$/);
assert.equal(auth.tokenHash, sha256(auth.token));
assert.notEqual(auth.tokenHash, auth.token);
const invite = "partner-invite-plaintext-never-in-auth-email";
const inviteHash = sha256(invite);
assert.notEqual(inviteHash, invite);

const expected: Record<string, string> = { en: "Verify your SoundSpa email", ru: "Подтвердите email SoundSpa", vi: "Xác minh email SoundSpa", th: "ยืนยันอีเมล SoundSpa" };
const loginExpected: Record<string, string> = { en: "Your SoundSpa sign-in link", ru: "Ссылка для входа в SoundSpa", vi: "Liên kết đăng nhập SoundSpa", th: "ลิงก์เข้าสู่ระบบ SoundSpa" };
for (const dictionary of [en, ru, vi, th]) {
  assert(dictionary.authCheckEmailTitle.length > 0);
  assert(dictionary.authCheckEmailDescription.includes("{{email}}") === false, "The generic success copy does not require account-specific server data.");
  assert(dictionary.partnerAccessActive.length > 0);
}
for (const [locale, subject] of Object.entries(expected)) {
  const rendered = renderCustomerAuthEmail("verify_email", locale, `https://test.example/login#token=${auth.token}`);
  assert.equal(rendered.subject, subject);
  assert.ok(rendered.text.includes(auth.token));
  assert.equal(rendered.text.includes(invite), false);
  assert.equal(rendered.html.includes(invite), false);
  const loginRendered = renderCustomerAuthEmail("login_link", locale, `https://test.example/login#token=${auth.token}`);
  assert.equal(loginRendered.subject, loginExpected[locale]);
  assert.equal(loginRendered.text.includes(invite), false);
}
assert.match(renderCustomerAuthEmail("login_link", "en", "https://test.example/login?a=1&b=2").html, /a=1&amp;b=2/);
assert.equal(renderCustomerAuthEmail("verify_email", "fr", "https://test.example/login#token=x").subject, expected.en);
assert.equal(renderCustomerAuthEmail("verify_email", null, "https://test.example/login#token=x").subject, expected.en);
assert.equal(AUTH_TOKEN_TTL_MS, 30 * 60_000);
assert.equal(SIGNUP_INTENT_TTL_MS, 24 * 60 * 60_000);
assert.equal(CUSTOMER_SESSION_TTL_MS, 30 * 24 * 60 * 60_000);
const headers = new Headers(authResponseHeaders());
assert.equal(headers.get("Cache-Control"), "no-store");
assert.equal(headers.get("Referrer-Policy"), "no-referrer");
for (let attempt = 0; attempt < 8; attempt += 1) assert.equal(allowAuthRequest("unit-rate-key", 10_000), true);
assert.equal(allowAuthRequest("unit-rate-key", 10_000), false);
assert.equal(allowAuthRequest("unit-rate-key", 10_000 + 15 * 60_000), true);
console.log("Customer auth pure checks passed; no database or email provider used.");
