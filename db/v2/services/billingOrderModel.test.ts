import assert from "node:assert/strict";
import test from "node:test";
import {
  BillingOrderModelError,
  quoteBillingRoute,
  selectCompatibleBillingQuotes,
  validateBillingOrderRequest,
  type BillingRouteQuoteCandidate,
} from "./billingOrderModel";

const org = "00000000-0000-4000-8000-000000000001";
const locationA = "00000000-0000-4000-8000-000000000002";
const locationB = "00000000-0000-4000-8000-000000000003";
const productA = "00000000-0000-4000-8000-000000000004";
const productB = "00000000-0000-4000-8000-000000000005";
const stagingEnv = {
  V2_DEPLOYMENT_ENV: "staging",
  V2_FAKE_PROVIDER_ENABLED: "1",
  V2_PUBLIC_ORIGIN: "https://test.soundspa.bodhemusic.com",
  V2_FAKE_PROVIDER_SECRET: "test-only-secret-with-at-least-thirty-two-bytes",
};

function candidate(overrides: Partial<BillingRouteQuoteCandidate> = {}): BillingRouteQuoteCandidate {
  return {
    routeId: "route-a", providerCode: "fake-staging", currency: "RUB", marketCode: "RU",
    externalReference: "test-route", displayOrder: 10, listAmountMinor: BigInt(108_000),
    discountAmountMinor: BigInt(0), ...overrides,
  };
}

test("validates one or multiple Location/Product lines and 1–12 month durations", () => {
  const parsed = validateBillingOrderRequest({ organizationId: org, lines: [
    { locationId: locationA, productId: productA, durationMonths: 1 },
    { locationId: locationB, productId: productB, durationMonths: 12 },
  ] });
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[1].durationMonths, 12);
});

test("rejects malformed requests, invalid duration values, and duplicate Location/Product lines", () => {
  for (const durationMonths of [0, 13, 1.5, "3"]) {
    assert.throws(() => validateBillingOrderRequest({ organizationId: org, lines: [
      { locationId: locationA, productId: productA, durationMonths },
    ] }), (error: unknown) => error instanceof BillingOrderModelError && error.code === "invalid_request");
  }
  assert.throws(() => validateBillingOrderRequest({ organizationId: org, lines: [
    { locationId: locationA, productId: productA, durationMonths: 1 },
    { locationId: locationA.toUpperCase(), productId: productA, durationMonths: 2 },
  ] }), (error: unknown) => error instanceof BillingOrderModelError && error.code === "duplicate_line");
});

test("Fake Provider pricing uses its trusted RU monthly amount times duration", () => {
  const quote = quoteBillingRoute({
    routeId: "route-a", providerCode: "fake-staging", marketCode: "RU", externalReference: "test-route",
    displayOrder: 0, durationMonths: 3, env: stagingEnv,
  });
  assert.equal(quote?.currency, "RUB");
  assert.equal(quote?.listAmountMinor, BigInt(324_000));
  assert.equal(quote?.discountAmountMinor, BigInt(0));
});

test("provider pricing adapters can supply market-specific quotes without changing generic selection", () => {
  const quote = quoteBillingRoute({
    routeId: "vn-route", providerCode: "vn-provider", marketCode: "VN", externalReference: "provider-plan",
    displayOrder: 0, durationMonths: 6, env: {},
  }, [{
    providerCode: "vn-provider",
    quote: ({ marketCode, durationMonths }) => marketCode === "VN" && durationMonths === 6
      ? { currency: "VND", listAmountMinor: BigInt(600_000), discountAmountMinor: BigInt(0) }
      : null,
  }]);
  assert.equal(quote?.currency, "VND");
  assert.equal(quote?.listAmountMinor, BigInt(600_000));
});

test("Fake Provider pricing fails closed outside its staging guard and market", () => {
  const input = {
    routeId: "route-a", providerCode: "fake-staging", marketCode: "RU", externalReference: "test-route",
    displayOrder: 0, durationMonths: 1,
  };
  assert.equal(quoteBillingRoute({ ...input, env: {} }), null);
  assert.equal(quoteBillingRoute({ ...input, marketCode: "VN", env: stagingEnv }), null);
  assert.equal(quoteBillingRoute({ ...input, providerCode: "prodamus", env: stagingEnv }), null);
});

test("selects routes deterministically and permits combined markets only on a common provider/currency", () => {
  const selected = selectCompatibleBillingQuotes([
    [candidate({ routeId: "z", displayOrder: 5 }), candidate({ routeId: "a", displayOrder: 1 })],
    [candidate({ routeId: "vn", marketCode: "VN", displayOrder: 2 })],
  ]);
  assert.deepEqual(selected.map((route) => route.routeId), ["a", "vn"]);

  assert.throws(() => selectCompatibleBillingQuotes([
    [candidate()], [candidate({ providerCode: "another-provider" })],
  ]), (error: unknown) => error instanceof BillingOrderModelError && error.code === "incompatible_routes");
  assert.throws(() => selectCompatibleBillingQuotes([
    [candidate()], [candidate({ currency: "VND" })],
  ]), (error: unknown) => error instanceof BillingOrderModelError && error.code === "incompatible_routes");
  assert.throws(() => selectCompatibleBillingQuotes([[]]), (error: unknown) => error instanceof BillingOrderModelError && error.code === "unsupported_pricing");
});

test("does not use client-provided prices or totals as part of the accepted input shape", () => {
  const parsed = validateBillingOrderRequest({
    organizationId: org,
    providerCode: "attacker-selected",
    currency: "USD",
    totalAmountMinor: 1,
    lines: [{ locationId: locationA, productId: productA, durationMonths: 3, amountMinor: 1, discountAmountMinor: 0 }],
  });
  assert.deepEqual(parsed, { organizationId: org, lines: [{ locationId: locationA, productId: productA, durationMonths: 3 }] });
});
