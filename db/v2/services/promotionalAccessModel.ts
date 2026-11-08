import { addBillingCalendarMonths, billingAnchorForDate } from "./billingCalendar";

const DAY_MS = 86_400_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export type PromotionalDuration = { unit: "calendar_months" | "days"; value: number };
export type PromotionalPeriod = { startsAt: Date; endsAt: Date };

export class PromotionalAccessConflict extends Error {
  constructor(readonly code: "paid_coverage" | "overlapping_promotions" | "trial_promotion_overlap") {
    super(code);
    this.name = "PromotionalAccessConflict";
  }
}

export function promotionalPeriodEnd(startsAt: Date, duration: PromotionalDuration): Date {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isSafeInteger(duration.value) || duration.value <= 0 || duration.value > MAX_POSTGRES_INTEGER) {
    throw new RangeError("invalid_promotional_duration");
  }
  if (duration.unit === "calendar_months") {
    if (duration.value > 12) throw new RangeError("invalid_promotional_duration");
    return addBillingCalendarMonths(startsAt, duration.value, billingAnchorForDate(startsAt));
  }
  const endsAt = new Date(startsAt.getTime() + duration.value * DAY_MS);
  if (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new RangeError("invalid_promotional_duration");
  return endsAt;
}

/** Append a non-overlapping promotional period without changing existing rights. */
export function planPromotionalPeriod(input: {
  now: Date;
  duration: PromotionalDuration;
  activeBasicTrialEnd?: Date | null;
  existingPromotions: readonly PromotionalPeriod[];
  hasCurrentOrFuturePaidCoverage?: boolean;
}): PromotionalPeriod {
  if (!Number.isFinite(input.now.getTime())) throw new RangeError("invalid_promotional_now");
  if (input.hasCurrentOrFuturePaidCoverage) throw new PromotionalAccessConflict("paid_coverage");

  const periods = [...input.existingPromotions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let i = 0; i < periods.length; i++) {
    const current = periods[i]!;
    if (!Number.isFinite(current.startsAt.getTime()) || !Number.isFinite(current.endsAt.getTime()) || current.endsAt <= current.startsAt) {
      throw new RangeError("invalid_existing_promotional_period");
    }
    if (i > 0 && periods[i - 1]!.endsAt > current.startsAt) throw new PromotionalAccessConflict("overlapping_promotions");
  }

  const startsAt = new Date(Math.max(
    input.now.getTime(),
    input.activeBasicTrialEnd && input.activeBasicTrialEnd > input.now ? input.activeBasicTrialEnd.getTime() : 0,
    ...periods.filter((period) => period.endsAt > input.now).map((period) => period.endsAt.getTime()),
  ));
  if (input.activeBasicTrialEnd && input.activeBasicTrialEnd > input.now && periods.some((period) =>
    period.startsAt < input.activeBasicTrialEnd! && period.endsAt > input.now)) {
    throw new PromotionalAccessConflict("trial_promotion_overlap");
  }
  return { startsAt, endsAt: promotionalPeriodEnd(startsAt, input.duration) };
}
