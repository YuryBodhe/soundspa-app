import assert from "node:assert/strict";
import test from "node:test";
import { resolveBillingOrderState } from "./billingOrderReadModel";

const now = new Date("2026-10-09T12:00:00.000Z");

test("billing order status is derived from stored states and expiry without mutation", () => {
  assert.equal(resolveBillingOrderState({ orderStatus: "draft", expiresAt: null, paymentStatus: null }, now), "draft");
  assert.equal(resolveBillingOrderState({ orderStatus: "pending", expiresAt: new Date("2026-10-10T00:00:00.000Z"), paymentStatus: "pending" }, now), "pending");
  assert.equal(resolveBillingOrderState({ orderStatus: "pending", expiresAt: new Date("2026-10-08T00:00:00.000Z"), paymentStatus: "pending" }, now), "expired");
  assert.equal(resolveBillingOrderState({ orderStatus: "paid", expiresAt: null, paymentStatus: "succeeded" }, now), "paid");
  assert.equal(resolveBillingOrderState({ orderStatus: "canceled", expiresAt: null, paymentStatus: "canceled" }, now), "canceled");
  assert.equal(resolveBillingOrderState({ orderStatus: "failed", expiresAt: null, paymentStatus: "failed" }, now), "failed");
});

test("stored terminal order/payment states take precedence over an old expiry", () => {
  const expiredAt = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(resolveBillingOrderState({ orderStatus: "paid", expiresAt: expiredAt, paymentStatus: "succeeded" }, now), "paid");
  assert.equal(resolveBillingOrderState({ orderStatus: "canceled", expiresAt: expiredAt, paymentStatus: "canceled" }, now), "canceled");
});
