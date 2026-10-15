import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationLinkUrl, registrationTokenFromHash } from "./registrationLinkUrl";

test("Registration Link token is issued only in the fragment, never in the request path or query", () => {
  const token = Buffer.alloc(32, 0x5a).toString("base64url");
  const url = new URL(buildRegistrationLinkUrl("https://test.soundspa.bodhemusic.com", token));
  assert.equal(url.pathname, "/register");
  assert.equal(url.search, "");
  assert.equal(registrationTokenFromHash(url.hash), token);
  assert.equal(`${url.pathname}${url.search}`.includes(token), false);
});

test("Registration Link fragment parser rejects malformed and missing tokens", () => {
  assert.equal(registrationTokenFromHash(""), null);
  assert.equal(registrationTokenFromHash("#token=short"), null);
  assert.equal(registrationTokenFromHash(`#token=${"x".repeat(43)}&other=value`), `${"x".repeat(43)}`);
});
