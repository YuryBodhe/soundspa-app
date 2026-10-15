import assert from "node:assert/strict";
import test from "node:test";
import { planSpaquatoriaPromoPeriods } from "./spaquatoriaPromoModel";

const now = new Date("2026-10-15T00:00:00.000Z");
const day = 86_400_000;

test("promo starts now when no benefit exists and appends after furthest finite period", () => {
  assert.deepEqual(planSpaquatoriaPromoPeriods([], now, 30), {
    status: "planned", periods: [{ startsAt: now, endsAt: new Date(now.getTime() + 30 * day) }], grantedDurationMs: 30 * day,
  });
  const plan = planSpaquatoriaPromoPeriods([
    { startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 20 * day) },
    { startsAt: new Date(now.getTime() + 10 * day), endsAt: new Date(now.getTime() + 40 * day) },
    { startsAt: new Date(now.getTime() - 50 * day), endsAt: new Date(now.getTime() - day) },
  ], now, 60);
  assert.deepEqual(plan, { status: "planned", periods: [{ startsAt: new Date(now.getTime() + 40 * day), endsAt: new Date(now.getTime() + 100 * day) }], grantedDurationMs: 60 * day });
});

test("active indefinite access is already covered", () => {
  assert.deepEqual(planSpaquatoriaPromoPeriods([{ startsAt: now, endsAt: null }], now, 30), { status: "already_covered", periods: [], grantedDurationMs: 0 });
});

test("future indefinite access caps promo to the gap and does not overlap finite periods", () => {
  const permanentStarts = new Date(now.getTime() + 50 * day);
  const plan = planSpaquatoriaPromoPeriods([
    { startsAt: now, endsAt: new Date(now.getTime() + 10 * day) },
    { startsAt: new Date(now.getTime() + 20 * day), endsAt: new Date(now.getTime() + 30 * day) },
    { startsAt: permanentStarts, endsAt: null },
  ], now, 30);
  assert.deepEqual(plan, {
    status: "planned",
    periods: [
      { startsAt: new Date(now.getTime() + 10 * day), endsAt: new Date(now.getTime() + 20 * day) },
      { startsAt: new Date(now.getTime() + 30 * day), endsAt: new Date(now.getTime() + 50 * day) },
    ],
    grantedDurationMs: 30 * day,
  });
});

test("future indefinite access with no uncovered interval is not consumed", () => {
  const permanentStarts = new Date(now.getTime() + 20 * day);
  const result = planSpaquatoriaPromoPeriods([
    { startsAt: now, endsAt: new Date(now.getTime() + 10 * day) },
    { startsAt: new Date(now.getTime() + 10 * day), endsAt: permanentStarts },
    { startsAt: permanentStarts, endsAt: null },
  ], now, 30);
  assert.deepEqual(result, { status: "already_covered", periods: [], grantedDurationMs: 0 });
});

test("promo capped by future permanent access can be shorter than one full day", () => {
  const permanentStarts = new Date(now.getTime() + 3_600_000);
  const result = planSpaquatoriaPromoPeriods([{ startsAt: permanentStarts, endsAt: null }], now, 30);
  assert.deepEqual(result, { status: "planned", periods: [{ startsAt: now, endsAt: permanentStarts }], grantedDurationMs: 3_600_000 });
});

test("promo duration validates from 1 through 365 days", () => {
  assert.throws(() => planSpaquatoriaPromoPeriods([], now, 0), RangeError);
  assert.throws(() => planSpaquatoriaPromoPeriods([], now, 366), RangeError);
});
