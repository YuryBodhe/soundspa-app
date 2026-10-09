import assert from "node:assert/strict";
import test from "node:test";
import {
  addBillingCalendarMonths,
  billingAnchorForDate,
  planBillingCalendarPeriod,
  planNextSubscriptionPeriod,
} from "./billingCalendar";

const date = (value: string) => new Date(value);

test("adds each supported duration as calendar months and preserves end-of-month anchors", () => {
  const start = date("2024-01-31T12:34:56.789Z");
  const anchor = billingAnchorForDate(start);
  for (let months = 1; months <= 12; months += 1) {
    const expected = ["2024-02-29", "2024-03-31", "2024-04-30", "2024-05-31", "2024-06-30", "2024-07-31", "2024-08-31", "2024-09-30", "2024-10-31", "2024-11-30", "2024-12-31", "2025-01-31"][months - 1];
    const result = addBillingCalendarMonths(start, months, anchor);
    assert.equal(result.toISOString(), `${expected}T12:34:56.789Z`);
  }
});

test("clamps non-month-end anchors in short months and restores the original day afterward", () => {
  const anchor = billingAnchorForDate(date("2024-01-30T08:00:00.000Z"));
  assert.equal(anchor.isEndOfMonth, false);
  assert.equal(addBillingCalendarMonths(date("2024-01-30T08:00:00.000Z"), 1, anchor).toISOString(), "2024-02-29T08:00:00.000Z");
  assert.equal(addBillingCalendarMonths(date("2024-01-30T08:00:00.000Z"), 2, anchor).toISOString(), "2024-03-30T08:00:00.000Z");
});

test("handles leap and non-leap February while preserving a month-end anchor", () => {
  const anchor = { dayOfMonth: 31, isEndOfMonth: true };
  assert.equal(addBillingCalendarMonths(date("2024-01-31T00:00:00.000Z"), 1, anchor).toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(addBillingCalendarMonths(date("2025-01-31T00:00:00.000Z"), 1, anchor).toISOString(), "2025-02-28T00:00:00.000Z");
  assert.equal(addBillingCalendarMonths(date("2025-02-28T00:00:00.000Z"), 1, anchor).toISOString(), "2025-03-31T00:00:00.000Z");
});

test("repeated one-month extensions retain the original anchor without cumulative drift", () => {
  const anchor = { dayOfMonth: 31, isEndOfMonth: true };
  let current = date("2023-01-31T00:00:00.000Z");
  for (let index = 0; index < 12; index += 1) current = addBillingCalendarMonths(current, 1, anchor);
  assert.equal(current.toISOString(), "2024-01-31T00:00:00.000Z");
});

test("active periods extend from paid-through; expired periods start now with a fresh anchor", () => {
  const now = date("2024-02-10T00:00:00.000Z");
  const active = planBillingCalendarPeriod({
    now,
    durationMonths: 1,
    existingPeriod: {
      startsAt: date("2024-01-31T00:00:00.000Z"),
      endsAt: date("2024-02-29T00:00:00.000Z"),
      anchor: { dayOfMonth: 31, isEndOfMonth: true },
    },
  });
  assert.equal(active.startsAt.toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(active.endsAt.toISOString(), "2024-03-31T00:00:00.000Z");

  const expired = planBillingCalendarPeriod({
    now,
    durationMonths: 1,
    existingPeriod: {
      startsAt: date("2023-01-31T00:00:00.000Z"),
      endsAt: date("2023-02-28T00:00:00.000Z"),
      anchor: { dayOfMonth: 31, isEndOfMonth: true },
    },
  });
  assert.equal(expired.startsAt.toISOString(), now.toISOString());
  assert.equal(expired.endsAt.toISOString(), "2024-03-10T00:00:00.000Z");
  assert.deepEqual(expired.anchor, { dayOfMonth: 10, isEndOfMonth: false });
});

test("rejects invalid durations and refuses to replace an unbounded paid period", () => {
  const anchor = { dayOfMonth: 31, isEndOfMonth: true };
  assert.throws(() => addBillingCalendarMonths(date("2024-01-31T00:00:00.000Z"), 0, anchor), /invalid_billing_duration/);
  assert.throws(() => addBillingCalendarMonths(date("2024-01-31T00:00:00.000Z"), 13, anchor), /invalid_billing_duration/);
  assert.throws(() => planBillingCalendarPeriod({
    now: date("2024-02-01T00:00:00.000Z"),
    durationMonths: 1,
    existingPeriod: { startsAt: date("2024-01-01T00:00:00.000Z"), endsAt: null, anchor: null },
  }), /unbounded_subscription_requires_policy/);
});

const noAnchor = { billingAnchorDay: null, billingAnchorIsEndOfMonth: null };
test("starts a purchase after the active same-Product trial without altering the trial", () => {
  const now = date("2026-10-09T10:24:00.000Z");
  const trial = { status: "active", startsAt: date("2026-10-07T07:05:10.899Z"), endsAt: date("2026-11-06T07:05:10.899Z") };
  const period = planNextSubscriptionPeriod({ now, durationMonths: 1, subscriptions: [], trial });
  assert.equal(period.startsAt.toISOString(), trial.endsAt.toISOString());
  assert.equal(period.endsAt.toISOString(), "2026-12-06T07:05:10.899Z");
  assert.equal(period.subscriptionId, null);
  assert.equal(trial.endsAt.toISOString(), "2026-11-06T07:05:10.899Z");
});

test("extends an active paid period using its existing calendar anchor", () => {
  const period = planNextSubscriptionPeriod({ now: date("2026-02-10T00:00:00.000Z"), durationMonths: 1, trial: null, subscriptions: [{
    status: "active", startsAt: date("2026-01-31T00:00:00.000Z"), endsAt: date("2026-02-28T00:00:00.000Z"),
    billingAnchorDay: 31, billingAnchorIsEndOfMonth: true,
  }] });
  assert.equal(period.startsAt.toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(period.endsAt.toISOString(), "2026-03-31T00:00:00.000Z");
});

test("includes future paid coverage and schedules distinct purchases without gaps", () => {
  const now = date("2026-10-09T10:24:00.000Z");
  const first = planNextSubscriptionPeriod({ now, durationMonths: 1, trial: null, subscriptions: [], });
  const second = planNextSubscriptionPeriod({ now, durationMonths: 1, trial: null, subscriptions: [{
    id: "subscription-1", status: "active", startsAt: first.startsAt, endsAt: first.endsAt,
    billingAnchorDay: first.anchor.dayOfMonth, billingAnchorIsEndOfMonth: first.anchor.isEndOfMonth,
  }] });
  assert.equal(second.startsAt.toISOString(), first.endsAt.toISOString());
  assert.equal(second.endsAt.toISOString(), "2026-12-09T10:24:00.000Z");
  assert.equal(second.subscriptionId, "subscription-1");
});

test("a later-ending trial keeps an existing paid row separate from the new future paid period", () => {
  const period = planNextSubscriptionPeriod({ now: date("2026-10-09T00:00:00.000Z"), durationMonths: 1,
    trial: { status: "active", startsAt: date("2026-10-01T00:00:00.000Z"), endsAt: date("2026-11-15T00:00:00.000Z") },
    subscriptions: [{ id: "prior-paid", status: "active", startsAt: date("2026-09-01T00:00:00.000Z"), endsAt: date("2026-11-01T00:00:00.000Z"), billingAnchorDay: 1, billingAnchorIsEndOfMonth: false }],
  });
  assert.equal(period.startsAt.toISOString(), "2026-11-15T00:00:00.000Z");
  assert.equal(period.endsAt.toISOString(), "2026-12-15T00:00:00.000Z");
  assert.equal(period.subscriptionId, null, "the existing paid row is not lengthened across trial-only coverage");
});

test("ignores expired trials and expired subscriptions", () => {
  const now = date("2026-10-09T00:00:00.000Z");
  const period = planNextSubscriptionPeriod({ now, durationMonths: 1,
    trial: { status: "active", startsAt: date("2026-09-01T00:00:00.000Z"), endsAt: date("2026-10-01T00:00:00.000Z") },
    subscriptions: [{ status: "active", startsAt: date("2026-08-01T00:00:00.000Z"), endsAt: date("2026-09-01T00:00:00.000Z"), ...noAnchor }],
  });
  assert.equal(period.startsAt.toISOString(), now.toISOString());
});

test("uses the furthest end for overlapping historical rows and its anchor", () => {
  const period = planNextSubscriptionPeriod({ now: date("2026-01-15T00:00:00.000Z"), durationMonths: 1, trial: null, subscriptions: [
    { status: "active", startsAt: date("2026-01-01T00:00:00.000Z"), endsAt: date("2026-04-01T00:00:00.000Z"), billingAnchorDay: 1, billingAnchorIsEndOfMonth: false },
    { status: "canceled", startsAt: date("2025-12-01T00:00:00.000Z"), endsAt: date("2026-05-31T00:00:00.000Z"), billingAnchorDay: 31, billingAnchorIsEndOfMonth: true },
    { status: "active", startsAt: date("2025-01-01T00:00:00.000Z"), endsAt: date("2025-02-01T00:00:00.000Z"), ...noAnchor },
  ] });
  assert.equal(period.startsAt.toISOString(), "2026-05-31T00:00:00.000Z");
  assert.deepEqual(period.anchor, { dayOfMonth: 31, isEndOfMonth: true });
  assert.equal(period.endsAt.toISOString(), "2026-06-30T00:00:00.000Z");
});

test("rejects an unbounded paid subscription instead of silently replacing its coverage", () => {
  assert.throws(() => planNextSubscriptionPeriod({
    now: date("2026-10-09T00:00:00.000Z"), durationMonths: 1, trial: null,
    subscriptions: [{ status: "active", startsAt: date("2026-01-01T00:00:00.000Z"), endsAt: null, ...noAnchor }],
  }), /unbounded_subscription_requires_policy/);
});

test("does not mix independent Product timelines or unrelated benefit/admin grants", () => {
  // The planner accepts only this Product's trial and subscriptions. Partner
  // Benefits and Location Admin Grants are separate inputs and remain untouched.
  const ownProduct = planNextSubscriptionPeriod({ now: date("2026-05-01T00:00:00.000Z"), durationMonths: 1, trial: null, subscriptions: [] });
  const otherProduct = planNextSubscriptionPeriod({ now: date("2026-05-01T00:00:00.000Z"), durationMonths: 1,
    trial: { status: "active", startsAt: date("2026-01-01T00:00:00.000Z"), endsAt: date("2027-01-01T00:00:00.000Z") }, subscriptions: [],
  });
  assert.equal(ownProduct.startsAt.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(otherProduct.startsAt.toISOString(), "2027-01-01T00:00:00.000Z");
});
