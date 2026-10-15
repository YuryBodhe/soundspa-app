export type PromoBenefitPeriod = { startsAt: Date; endsAt: Date | null };
export type PromoPeriodPlan =
  | { status: "already_covered"; periods: []; grantedDurationMs: 0 }
  | { status: "planned"; periods: { startsAt: Date; endsAt: Date }[]; grantedDurationMs: number };

const DAY_MS = 86_400_000;

/**
 * Plan only additive, finite Spaquatoria access. Without a future permanent
 * benefit, new time follows the furthest unexpired finite period. Before a
 * future permanent benefit, fill uncovered gaps without overlapping existing
 * finite periods and cap the grant at the permanent benefit's start.
 */
export function planSpaquatoriaPromoPeriods(
  existing: readonly PromoBenefitPeriod[],
  now: Date,
  durationDays: number,
): PromoPeriodPlan {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    throw new RangeError("Invalid Spaquatoria promo period input.");
  }
  if (existing.some((period) => period.startsAt <= now && period.endsAt === null)) {
    return { status: "already_covered", periods: [], grantedDurationMs: 0 };
  }

  const futurePermanentStart = existing
    .filter((period) => period.startsAt > now && period.endsAt === null)
    .reduce<Date | null>((earliest, period) => !earliest || period.startsAt < earliest ? period.startsAt : earliest, null);
  const requestedMs = durationDays * DAY_MS;

  if (!futurePermanentStart) {
    const furthestFiniteEnd = existing
      .filter((period): period is PromoBenefitPeriod & { endsAt: Date } => period.endsAt !== null && period.endsAt > now)
      .reduce<Date | null>((furthest, period) => !furthest || period.endsAt > furthest ? period.endsAt : furthest, null);
    const startsAt = furthestFiniteEnd && furthestFiniteEnd > now ? furthestFiniteEnd : now;
    const endsAt = new Date(startsAt.getTime() + requestedMs);
    if (!Number.isFinite(endsAt.getTime())) throw new RangeError("Promo period exceeds timestamp range.");
    return { status: "planned", periods: [{ startsAt, endsAt }], grantedDurationMs: requestedMs };
  }

  const boundary = futurePermanentStart.getTime();
  const finite = existing
    .filter((period): period is PromoBenefitPeriod & { endsAt: Date } => period.endsAt !== null && period.endsAt > now && period.startsAt < futurePermanentStart)
    .map((period) => ({ start: Math.max(now.getTime(), period.startsAt.getTime()), end: Math.min(boundary, period.endsAt.getTime()) }))
    .filter((period) => period.end > period.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: { start: number; end: number }[] = [];
  for (const period of finite) {
    const previous = merged.at(-1);
    if (!previous || period.start > previous.end) merged.push({ ...period });
    else previous.end = Math.max(previous.end, period.end);
  }

  let cursor = now.getTime();
  let remaining = requestedMs;
  const periods: { startsAt: Date; endsAt: Date }[] = [];
  const addGap = (start: number, end: number) => {
    if (remaining <= 0 || end <= start) return;
    const amount = Math.min(remaining, end - start);
    periods.push({ startsAt: new Date(start), endsAt: new Date(start + amount) });
    remaining -= amount;
  };
  for (const interval of merged) {
    addGap(cursor, interval.start);
    cursor = Math.max(cursor, interval.end);
  }
  addGap(cursor, boundary);
  const grantedDurationMs = requestedMs - remaining;
  if (grantedDurationMs === 0) return { status: "already_covered", periods: [], grantedDurationMs: 0 };
  return { status: "planned", periods, grantedDurationMs };
}
