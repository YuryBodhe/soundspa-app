import assert from "node:assert/strict";
import test from "node:test";
import {
  explicitMarketCode,
  incomingEventIsNewer,
  paymentEventIdentity,
  paymentTransactionIdentity,
  selectEnabledPaymentRoutes,
  validateNormalizedPaymentInput,
  type PaymentRouteChoice,
} from "./paymentFoundationModel";

const routes: PaymentRouteChoice[] = [
  { id: "b", providerCode: "provider-b", externalReference: "plan-b", displayOrder: 2, createdAt: "2026-01-01", isEnabled: true, providerEnabled: true },
  { id: "disabled", providerCode: "provider-a", externalReference: "disabled", displayOrder: 0, createdAt: "2026-01-01", isEnabled: false, providerEnabled: true },
  { id: "provider-off", providerCode: "provider-c", externalReference: "off", displayOrder: 0, createdAt: "2026-01-01", isEnabled: true, providerEnabled: false },
  { id: "a", providerCode: "provider-a", externalReference: "plan-a", displayOrder: 1, createdAt: "2026-01-01", isEnabled: true, providerEnabled: true },
];

test("market is explicit Location data and is not inferred from locale", () => {
  assert.equal(explicitMarketCode("VN"), "VN");
  assert.equal(explicitMarketCode(null), null);
  assert.equal(explicitMarketCode("vi"), null);
  assert.equal(explicitMarketCode("vn"), null);
});

test("same Product and market can expose multiple enabled providers in deterministic order", () => {
  assert.deepEqual(selectEnabledPaymentRoutes(routes).map(({ id }) => id), ["a", "b"]);
});

test("disabled routes and disabled providers are excluded", () => {
  assert.deepEqual(selectEnabledPaymentRoutes(routes).map(({ providerCode }) => providerCode), ["provider-a", "provider-b"]);
});

test("provider codes remain extensible without a provider enum", () => {
  const input = {
    providerCode: "thailand-provider-x", paymentKey: "charge-1", idempotencyKey: "evt-1",
    externalEventId: "evt-1", externalPaymentId: "charge-1", locationId: "loc", productId: "product",
    subscriptionId: null, routeId: null, externalSubscriptionRef: null, status: "succeeded" as const,
    amountMinor: BigInt(90000), currency: "THB", occurredAt: new Date("2026-10-01T00:00:00Z"),
  };
  assert.equal(validateNormalizedPaymentInput(input).providerCode, "thailand-provider-x");
});

test("Payment keeps actual minor-unit amount and currency without expected-price comparison", () => {
  const input = {
    providerCode: "prodamus", paymentKey: "charge-promo", idempotencyKey: "event-promo",
    externalEventId: "event-promo", externalPaymentId: "charge-promo", locationId: "loc", productId: "product",
    subscriptionId: null, routeId: null, externalSubscriptionRef: "subscription-1", status: "succeeded" as const,
    amountMinor: BigInt(90000), currency: "RUB", occurredAt: null,
  };
  assert.equal(validateNormalizedPaymentInput(input).amountMinor, BigInt(90000));
  assert.equal(validateNormalizedPaymentInput(input).currency, "RUB");
});

test("event retries dedupe by provider plus adapter identity while recurring transactions stay distinct", () => {
  assert.equal(paymentEventIdentity("provider", "evt-1"), paymentEventIdentity("provider", "evt-1"));
  assert.notEqual(paymentEventIdentity("provider-a", "evt-1"), paymentEventIdentity("provider-b", "evt-1"));
  assert.notEqual(paymentTransactionIdentity("prodamus", "charge-1"), paymentTransactionIdentity("prodamus", "charge-2"));
});

test("out-of-order provider events do not move transaction status backwards", () => {
  assert.equal(incomingEventIsNewer(new Date("2026-10-02"), new Date("2026-10-01")), false);
  assert.equal(incomingEventIsNewer(new Date("2026-10-01"), new Date("2026-10-02")), true);
});
