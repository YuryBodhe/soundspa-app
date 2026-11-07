import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarketCode, resolveCustomerBillingStatus } from "./customerBillingModel";

const now = new Date("2026-10-08T00:00:00.000Z");

test("billing status follows active trial and paid-through windows", () => {
  assert.equal(resolveCustomerBillingStatus({ trial: { status: "active", startsAt: "2026-10-01", endsAt: "2026-10-10" } }, now), "trial");
  assert.equal(resolveCustomerBillingStatus({ subscription: { status: "canceled", startsAt: "2026-10-01", currentPeriodEndsAt: "2026-11-01" } }, now), "subscription");
  assert.equal(resolveCustomerBillingStatus({
    trial: { status: "active", startsAt: "2026-10-01", endsAt: "2026-10-20" },
    subscription: { status: "active", startsAt: "2026-10-02", currentPeriodEndsAt: "2026-11-02" },
  }, now), "subscription");
  assert.equal(resolveCustomerBillingStatus({ trial: { status: "expired", startsAt: "2026-09-01", endsAt: "2026-10-01" } }, now), "expired");
});

test("an independent active partner benefit remains available without paid subscription", () => {
  assert.equal(resolveCustomerBillingStatus({ partnerBenefit: { startsAt: "2026-01-01", endsAt: null } }, now), "partner");
  assert.equal(resolveCustomerBillingStatus({}, now), "available");
});

test("future paid coverage is Upcoming rather than Expired after a trial ends", () => {
  assert.equal(resolveCustomerBillingStatus({
    trial: { status: "expired", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" },
    subscription: { status: "active", startsAt: "2026-11-25T00:00:00.000Z", currentPeriodEndsAt: "2027-01-25T00:00:00.000Z" },
  }, now), "upcoming");
});

test("a Location without current or prior entitlement has available billing status", () => {
  assert.equal(resolveCustomerBillingStatus({}, now), "available");
  assert.equal(resolveCustomerBillingStatus({ trial: { status: "active", startsAt: "2026-10-01", endsAt: "2026-10-10" } }, now), "trial");
  assert.equal(resolveCustomerBillingStatus({ subscription: { status: "active", startsAt: "2026-10-01", currentPeriodEndsAt: "2026-11-01" } }, now), "subscription");
  assert.equal(resolveCustomerBillingStatus({ trial: { status: "expired", startsAt: "2026-09-01", endsAt: "2026-10-01" } }, now), "expired");
});

test("market values must be explicit two-letter codes", () => {
  assert.equal(normalizeMarketCode(" ru "), "RU");
  assert.equal(normalizeMarketCode("Asia/Ho_Chi_Minh"), null);
  assert.equal(normalizeMarketCode(""), null);
});
