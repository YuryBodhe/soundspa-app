import assert from "node:assert/strict";
import test from "node:test";
import {
  paymentCanRestoreCanceledSubscription,
  preserveLatestPaidThrough,
  validateProviderPaidThrough,
} from "./paymentLifecycleModel";

const at = (day: number) => new Date(`2031-01-${String(day).padStart(2, "0")}T00:00:00.000Z`);

test("provider paid-through is required and must be after the provider event", () => {
  assert.equal(validateProviderPaidThrough(at(1), at(20)).getTime(), at(20).getTime());
  assert.throws(() => validateProviderPaidThrough(at(1), null), /provider_paid_through_required/);
  assert.throws(() => validateProviderPaidThrough(at(2), at(1)), /invalid_provider_paid_through/);
});

test("renewals keep the later provider-confirmed paid-through and never shorten it", () => {
  assert.equal(preserveLatestPaidThrough(at(20), at(30))?.getTime(), at(30).getTime());
  assert.equal(preserveLatestPaidThrough(at(30), at(20))?.getTime(), at(30).getTime());
  assert.equal(preserveLatestPaidThrough(null, at(20)), null);
});

test("only a payment strictly after cancellation can restore a subscription", () => {
  assert.equal(paymentCanRestoreCanceledSubscription(at(3), null), true);
  assert.equal(paymentCanRestoreCanceledSubscription(at(3), at(2)), true);
  assert.equal(paymentCanRestoreCanceledSubscription(at(2), at(2)), false);
  assert.equal(paymentCanRestoreCanceledSubscription(at(1), at(2)), false);
});
