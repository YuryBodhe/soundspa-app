export type BillingCalendarAnchor = {
  dayOfMonth: number;
  isEndOfMonth: boolean;
};

export type ExistingBillingPeriod = {
  startsAt: Date;
  endsAt: Date | null;
  anchor: BillingCalendarAnchor | null;
};

export type ScheduledBillingPeriod = {
  id?: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  billingAnchorDay: number | null;
  billingAnchorIsEndOfMonth: boolean | null;
};
export type ActiveTrialPeriod = { status: string; startsAt: Date; endsAt: Date };
export type PlannedSubscriptionPeriod = PlannedBillingPeriod & { subscriptionId: string | null };

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

/**
 * Plan paid time after all still-applicable same-Product coverage. Active
 * trials and paid periods (including future paid periods) are considered; expired
 * and not-yet-started trials are ignored. Overlapping subscriptions are
 * treated as one covered timeline through their furthest end. The anchor from
 * the subscription with that furthest end is retained; equal ends use the
 * later start, then the later stable input row. Trial-only coverage starts a
 * fresh calendar anchor at the trial end. Other grant sources are deliberately
 * excluded from paid billing-period planning.
 */
export function planNextSubscriptionPeriod(input: {
  now: Date;
  durationMonths: number;
  subscriptions: readonly ScheduledBillingPeriod[];
  trial?: ActiveTrialPeriod | null;
}): PlannedSubscriptionPeriod {
  assertValidDate(input.now);
  const eligibleSubscriptions = input.subscriptions.filter((row) =>
    (row.status === "active" || row.status === "canceled") && row.endsAt !== null &&
    row.endsAt.getTime() > input.now.getTime());
  if (input.subscriptions.some((row) => (row.status === "active" || row.status === "canceled") && row.endsAt === null)) {
    throw new RangeError("unbounded_subscription_requires_policy");
  }
  eligibleSubscriptions.sort((left, right) =>
    right.endsAt!.getTime() - left.endsAt!.getTime() ||
    right.startsAt.getTime() - left.startsAt.getTime());
  const paid = eligibleSubscriptions[0] ?? null;
  const trialIsActive = input.trial?.status === "active" &&
    input.trial.startsAt.getTime() <= input.now.getTime() && input.trial.endsAt.getTime() > input.now.getTime();
  const paidEnd = paid?.endsAt ?? null;
  const trialEnd = trialIsActive ? input.trial!.endsAt : null;
  const latestEnd = paidEnd && trialEnd
    ? (paidEnd.getTime() >= trialEnd.getTime() ? paidEnd : trialEnd)
    : paidEnd ?? trialEnd;

  if (!latestEnd) return { ...planBillingCalendarPeriod({ now: input.now, durationMonths: input.durationMonths }), subscriptionId: null };

  const startsAt = new Date(latestEnd);
  const anchor = paid && paidEnd?.getTime() === latestEnd.getTime() &&
    paid.billingAnchorDay !== null && paid.billingAnchorIsEndOfMonth !== null
    ? { dayOfMonth: paid.billingAnchorDay, isEndOfMonth: paid.billingAnchorIsEndOfMonth }
    : billingAnchorForDate(startsAt);
  return {
    startsAt,
    endsAt: addBillingCalendarMonths(startsAt, input.durationMonths, anchor),
    anchor,
    // Only extend an existing paid row if paid coverage reaches the selected
    // start. If a trial ends later, create a separate future paid row so the
    // old paid-through date and newly purchased window remain truthful.
    subscriptionId: paid && paidEnd?.getTime() === latestEnd.getTime() ? paid.id ?? null : null,
  };
}
