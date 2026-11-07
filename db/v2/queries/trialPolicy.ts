export const SOUNDSPA_BASIC_TRIAL_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

export function soundSpaBasicTrialEndsAt(startsAt: Date, durationDays = SOUNDSPA_BASIC_TRIAL_DAYS): Date {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    throw new Error("Invalid SoundSpa Basic trial period.");
  }
  return new Date(startsAt.getTime() + durationDays * DAY_MS);
}

export type TrialContinuityPeriod = { startsAt: Date; endsAt: Date | null };

/**
 * If ending a trial now would leave a gap before an already-paid future period,
 * defer its effective end until that period starts. The paid order dates remain
 * untouched. Returns null when current paid coverage already bridges the gap or
 * when there is no scheduled paid period.
 */
export function planSafeTrialTermination(input: {
  now: Date;
  naturalTrialEnd: Date;
  paidPeriods: readonly TrialContinuityPeriod[];
}): { deferredUntil: Date; paidStartsAt: Date } | null {
  if (!Number.isFinite(input.now.getTime()) || !Number.isFinite(input.naturalTrialEnd.getTime())) {
    throw new Error("Invalid trial termination date.");
  }
  const validPeriods = input.paidPeriods.filter((period) =>
    Number.isFinite(period.startsAt.getTime()) &&
    (period.endsAt === null || (Number.isFinite(period.endsAt.getTime()) && period.endsAt > period.startsAt)),
  );
  const nextPaid = validPeriods
    .filter((period) => period.startsAt > input.now)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())[0];
  if (!nextPaid) return null;

  // Determine whether paid periods already cover continuously from now until
  // that next start. Half-open periods mean an end exactly at the next start is
  // continuous, while an end before it would create a gap if the trial ended.
  let coveredThrough = input.now;
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const period of validPeriods) {
      if (period.startsAt <= coveredThrough && (period.endsAt === null || period.endsAt > coveredThrough)) {
        if (period.endsAt === null || period.endsAt >= nextPaid.startsAt) {
          return null;
        }
        coveredThrough = period.endsAt;
        advanced = true;
      }
    }
  }

  return {
    deferredUntil: new Date(Math.max(input.naturalTrialEnd.getTime(), nextPaid.startsAt.getTime())),
    paidStartsAt: nextPaid.startsAt,
  };
}
