export type BillingCalendarAnchor = {
  dayOfMonth: number;
  isEndOfMonth: boolean;
};

export type ExistingBillingPeriod = {
  startsAt: Date;
  endsAt: Date | null;
  anchor: BillingCalendarAnchor | null;
};

export type PlannedBillingPeriod = {
  startsAt: Date;
  endsAt: Date;
  anchor: BillingCalendarAnchor;
};

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new RangeError("invalid_billing_date");
}

function lastDayOfUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function billingAnchorForDate(value: Date): BillingCalendarAnchor {
  assertValidDate(value);
  const dayOfMonth = value.getUTCDate();
  return {
    dayOfMonth,
    isEndOfMonth: dayOfMonth === lastDayOfUtcMonth(value.getUTCFullYear(), value.getUTCMonth()),
  };
}

/** Add whole UTC calendar months, clamping short months without losing the original anchor. */
export function addBillingCalendarMonths(
  startsAt: Date,
  durationMonths: number,
  anchor: BillingCalendarAnchor,
): Date {
  assertValidDate(startsAt);
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 12) {
    throw new RangeError("invalid_billing_duration_months");
  }
  if (!Number.isInteger(anchor.dayOfMonth) || anchor.dayOfMonth < 1 || anchor.dayOfMonth > 31 ||
      typeof anchor.isEndOfMonth !== "boolean") {
    throw new RangeError("invalid_billing_anchor");
  }

  const absoluteTargetMonth = startsAt.getUTCFullYear() * 12 + startsAt.getUTCMonth() + durationMonths;
  const targetYear = Math.floor(absoluteTargetMonth / 12);
  const targetMonth = absoluteTargetMonth % 12;
  const targetLastDay = lastDayOfUtcMonth(targetYear, targetMonth);
  const targetDay = anchor.isEndOfMonth ? targetLastDay : Math.min(anchor.dayOfMonth, targetLastDay);
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    startsAt.getUTCHours(),
    startsAt.getUTCMinutes(),
    startsAt.getUTCSeconds(),
    startsAt.getUTCMilliseconds(),
  ));
}

/**
 * Extend from an unexpired paid-through instant, otherwise activate from now.
 * Existing periods with no end are intentionally rejected: replacing an
 * unbounded entitlement with a finite date could shorten access.
 */
export function planBillingCalendarPeriod(input: {
  now: Date;
  durationMonths: number;
  existingPeriod?: ExistingBillingPeriod | null;
}): PlannedBillingPeriod {
  assertValidDate(input.now);
  if (!Number.isInteger(input.durationMonths) || input.durationMonths < 1 || input.durationMonths > 12) {
    throw new RangeError("invalid_billing_duration_months");
  }

  const existing = input.existingPeriod ?? null;
  if (existing && existing.endsAt === null) throw new RangeError("unbounded_subscription_requires_policy");
  if (existing) assertValidDate(existing.startsAt);
  if (existing?.endsAt) assertValidDate(existing.endsAt);

  const extendsActivePeriod = Boolean(existing?.endsAt && existing.endsAt.getTime() > input.now.getTime());
  const startsAt = extendsActivePeriod ? new Date(existing!.endsAt!) : new Date(input.now);
  const anchor = extendsActivePeriod
    ? existing!.anchor ?? billingAnchorForDate(existing!.startsAt)
    : billingAnchorForDate(startsAt);
  const endsAt = addBillingCalendarMonths(startsAt, input.durationMonths, anchor);
  if (extendsActivePeriod && endsAt.getTime() <= existing!.endsAt!.getTime()) {
    throw new RangeError("billing_period_would_shorten_access");
  }
  return { startsAt, endsAt, anchor };
}
