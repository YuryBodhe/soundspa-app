import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addOneCalendarMonth,
  fakeConfirmedPaidThrough,
  fakeCancellationIdentity,
  fakeCancellationRequestSchema,
  fakeCheckoutRequestSchema,
  fakeConfirmationRequestSchema,
  fakeProviderIsConfigured,
  fakeProviderIsEnabled,
  fakeProviderUiIsAvailable,
  issueFakeCheckoutTicket,
  verifyFakeCheckoutTicket,
  FAKE_PROVIDER_ORIGIN,
} from "./fakePaymentProvider";

const secret = "local-fake-provider-test-secret-with-at-least-32-bytes";
const request = (host = "test.soundspa.bodhemusic.com", origin = FAKE_PROVIDER_ORIGIN) => new Request(`${FAKE_PROVIDER_ORIGIN}/api/v2/customer/payments/fake/confirm`, {
  method: "POST", headers: { host, origin },
});
const enabledEnv = {
  V2_DEPLOYMENT_ENV: "staging",
  V2_FAKE_PROVIDER_ENABLED: "1",
  V2_FAKE_PROVIDER_SECRET: secret,
  V2_PUBLIC_ORIGIN: FAKE_PROVIDER_ORIGIN,
};

test("Fake Provider requires every explicit staging guard and exact origin", () => {
  assert.equal(fakeProviderIsConfigured(enabledEnv), true);
  assert.equal(fakeProviderIsEnabled(enabledEnv, request()), true);
  assert.equal(fakeProviderIsEnabled({}, request()), false);
  assert.equal(fakeProviderIsEnabled({ ...enabledEnv, V2_DEPLOYMENT_ENV: "production" }, request()), false);
  assert.equal(fakeProviderIsEnabled({ ...enabledEnv, V2_FAKE_PROVIDER_ENABLED: "0" }, request()), false);
  assert.equal(fakeProviderIsEnabled({ ...enabledEnv, V2_PUBLIC_ORIGIN: "https://soundspa2.bodhemusic.com" }, request()), false);
  assert.equal(fakeProviderIsEnabled({ ...enabledEnv, V2_FAKE_PROVIDER_SECRET: "short" }, request()), false);
  assert.equal(fakeProviderIsEnabled(enabledEnv, request("soundspa2.bodhemusic.com")), false);
  assert.equal(fakeProviderIsEnabled(enabledEnv, request("test.soundspa.bodhemusic.com", "https://evil.example")), false);
  const readRequest = new Request(`${FAKE_PROVIDER_ORIGIN}/api/v2/customer/billing`, { headers: { host: "test.soundspa.bodhemusic.com" } });
  assert.equal(fakeProviderUiIsAvailable(enabledEnv, readRequest), true);
  assert.equal(fakeProviderUiIsAvailable(enabledEnv, new Request(`${FAKE_PROVIDER_ORIGIN}/api/v2/customer/billing`, { headers: { host: "soundspa2.bodhemusic.com" } })), false);
});

test("checkout ticket binds opaque payment and customer identity, and rejects tampering", () => {
  const ticket = { v: 1 as const, paymentId: "a8b2e99e-21d1-47cf-8f42-57b93fdd33d3", actorHash: "a".repeat(64), expiresAt: Date.now() + 1000 };
  const encoded = issueFakeCheckoutTicket(ticket, secret);
  assert.deepEqual(verifyFakeCheckoutTicket(encoded, secret), ticket);
  assert.equal(verifyFakeCheckoutTicket(`${encoded}x`, secret), null);
  assert.equal(verifyFakeCheckoutTicket(encoded, "a-different-secret-with-32-bytes-or-more"), null);
});

test("one-calendar-month period clamps month end without using a fixed day count", () => {
  assert.equal(addOneCalendarMonth(new Date("2026-01-31T12:34:56.789Z")).toISOString(), "2026-02-28T12:34:56.789Z");
  assert.equal(addOneCalendarMonth(new Date("2024-01-31T12:34:56.789Z")).toISOString(), "2024-02-29T12:34:56.789Z");
  assert.equal(addOneCalendarMonth(new Date("2026-03-15T00:00:00.000Z")).toISOString(), "2026-04-15T00:00:00.000Z");
});

test("renewal confirms a full calendar month after the current paid-through date", () => {
  const periodEnd = new Date("2026-11-30T12:00:00.000Z");
  const renewalTime = new Date("2026-10-10T12:00:00.000Z");
  assert.equal(fakeConfirmedPaidThrough(renewalTime, periodEnd).toISOString(), "2026-12-30T12:00:00.000Z");
  const afterExpiry = new Date("2026-12-01T12:00:00.000Z");
  assert.equal(fakeConfirmedPaidThrough(afterExpiry, periodEnd).toISOString(), "2027-01-01T12:00:00.000Z");
});

test("request schemas reject browser-supplied payment result or prices", () => {
  assert.equal(fakeCheckoutRequestSchema.safeParse({ locationId: "a8b2e99e-21d1-47cf-8f42-57b93fdd33d3", productId: "a8b2e99e-21d1-47cf-8f42-57b93fdd33d3", routeId: "a8b2e99e-21d1-47cf-8f42-57b93fdd33d3", amountMinor: 1 }).success, false);
  assert.equal(fakeConfirmationRequestSchema.safeParse({ confirmationToken: "signed", status: "succeeded" }).success, false);
  assert.equal(fakeConfirmationRequestSchema.safeParse({ confirmationToken: "signed", paidThroughAt: "2030-01-01" }).success, false);
  assert.equal(fakeCancellationRequestSchema.safeParse({ subscriptionId: "a8b2e99e-21d1-47cf-8f42-57b93fdd33d3", status: "canceled" }).success, false);
});

test("fake cancellation identity is stable for a paid period and changes on renewal", () => {
  const period = new Date("2026-11-08T10:00:00.000Z");
  assert.deepEqual(fakeCancellationIdentity("subscription-id", period), fakeCancellationIdentity("subscription-id", period));
  assert.notEqual(fakeCancellationIdentity("subscription-id", period).idempotencyKey, fakeCancellationIdentity("subscription-id", addOneCalendarMonth(period)).idempotencyKey);
});
