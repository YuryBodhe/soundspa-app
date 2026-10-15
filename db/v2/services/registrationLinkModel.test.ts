import assert from "node:assert/strict";
import test from "node:test";
import { getRegistrationLinkLifecycleStatus } from "./registrationLinkModel";
import { en } from "../../../app/i18n/dictionaries/en";
import { ru } from "../../../app/i18n/dictionaries/ru";
import { vi } from "../../../app/i18n/dictionaries/vi";
import { th } from "../../../app/i18n/dictionaries/th";

const now = new Date("2026-10-15T10:00:00.000Z");
const available = { disabledAt: null, expiresAt: null, maxRedemptions: null };

test("Registration Link lifecycle is active until explicitly disabled, expired, or exhausted", () => {
  assert.equal(getRegistrationLinkLifecycleStatus(available, 0, now), "active");
  assert.equal(getRegistrationLinkLifecycleStatus({ ...available, expiresAt: new Date(now.getTime() + 1) }, 0, now), "active");
  assert.equal(getRegistrationLinkLifecycleStatus({ ...available, expiresAt: now }, 0, now), "expired");
  assert.equal(getRegistrationLinkLifecycleStatus({ ...available, maxRedemptions: 2 }, 1, now), "active");
  assert.equal(getRegistrationLinkLifecycleStatus({ ...available, maxRedemptions: 2 }, 2, now), "exhausted");
  assert.equal(getRegistrationLinkLifecycleStatus({ ...available, disabledAt: now }, 0, now), "disabled");
  assert.equal(getRegistrationLinkLifecycleStatus({ disabledAt: now, expiresAt: now, maxRedemptions: 1 }, 1, now), "disabled", "revocation takes precedence in the displayed lifecycle state");
});

test("Registration Link customer messages are available in every supported locale", () => {
  for (const dictionary of [en, ru, vi, th]) {
    assert.equal(typeof dictionary.registrationLinkSignupNotice, "string");
    assert.ok(dictionary.registrationLinkSignupNotice.length > 0);
    assert.equal(typeof dictionary.registrationLinkUnavailable, "string");
    assert.ok(dictionary.registrationLinkUnavailable.length > 0);
  }
});
