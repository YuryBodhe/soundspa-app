import assert from "node:assert/strict";
import test from "node:test";
import { planPromotionalPeriod, promotionalPeriodEnd, PromotionalAccessConflict } from "./promotionalAccessModel";

const date = (value: string) => new Date(value);
const now = date("2026-11-08T12:00:00.000Z");

test("Basic promotional access starts after an active canonical trial and preserves its full calendar duration", () => {
  const result = planPromotionalPeriod({ now, duration: { unit: "calendar_months", value: 1 }, activeBasicTrialEnd: date("2026-12-06T05:40:47.733Z"), existingPromotions: [] });
  assert.equal(result.startsAt.toISOString(), "2026-12-06T05:40:47.733Z");
  assert.equal(result.endsAt.toISOString(), "2027-01-06T05:40:47.733Z");
});

test("a fresh one-month grant preserves end-of-month calendar arithmetic and milliseconds", () => {
  assert.equal(promotionalPeriodEnd(date("2025-01-31T05:40:47.733Z"), { unit: "calendar_months", value: 1 }).toISOString(), "2025-02-28T05:40:47.733Z");
  assert.equal(promotionalPeriodEnd(date("2024-01-31T05:40:47.733Z"), { unit: "calendar_months", value: 1 }).toISOString(), "2024-02-29T05:40:47.733Z");
});

test("day grants preserve exact elapsed days, including a 30-day Partner Invite", () => {
  assert.equal(promotionalPeriodEnd(now, { unit: "days", value: 30 }).toISOString(), "2026-12-08T12:00:00.000Z");
  assert.throws(() => promotionalPeriodEnd(now, { unit: "days", value: 2_147_483_648 }), /invalid_promotional_duration/);
});

test("queued promotions are appended without changing existing dates", () => {
  const first = { startsAt: date("2026-12-06T00:00:00.000Z"), endsAt: date("2027-01-06T00:00:00.000Z") };
  const next = planPromotionalPeriod({ now, duration: { unit: "days", value: 30 }, existingPromotions: [first] });
  assert.equal(next.startsAt.toISOString(), first.endsAt.toISOString());
  assert.equal(next.endsAt.toISOString(), "2027-02-05T00:00:00.000Z");
  assert.equal(first.startsAt.toISOString(), "2026-12-06T00:00:00.000Z");
});

test("paid coverage and overlapping prior promotions return explicit conflicts", () => {
  assert.throws(() => planPromotionalPeriod({ now, duration: { unit: "days", value: 30 }, existingPromotions: [], hasCurrentOrFuturePaidCoverage: true }), (error: unknown) => error instanceof PromotionalAccessConflict && error.code === "paid_coverage");
  assert.throws(() => planPromotionalPeriod({ now, duration: { unit: "days", value: 30 }, existingPromotions: [
    { startsAt: date("2026-12-01T00:00:00.000Z"), endsAt: date("2027-01-01T00:00:00.000Z") },
    { startsAt: date("2026-12-15T00:00:00.000Z"), endsAt: date("2027-01-15T00:00:00.000Z") },
  ] }), (error: unknown) => error instanceof PromotionalAccessConflict && error.code === "overlapping_promotions");
});

test("a pre-existing promotion overlapping an active trial is not silently moved", () => {
  assert.throws(() => planPromotionalPeriod({ now, duration: { unit: "days", value: 30 }, activeBasicTrialEnd: date("2026-12-06T00:00:00.000Z"), existingPromotions: [
    { startsAt: date("2026-11-01T00:00:00.000Z"), endsAt: date("2026-12-20T00:00:00.000Z") },
  ] }), (error: unknown) => error instanceof PromotionalAccessConflict && error.code === "trial_promotion_overlap");
});
