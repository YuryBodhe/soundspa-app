import assert from "node:assert/strict";
import test from "node:test";
import {
  addBillingCalendarMonths,
  billingAnchorForDate,
  planBillingCalendarPeriod,
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
