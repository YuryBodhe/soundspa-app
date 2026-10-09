export const SOUNDSPA_BASIC_TRIAL_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

export function soundSpaBasicTrialEndsAt(startsAt: Date, durationDays = SOUNDSPA_BASIC_TRIAL_DAYS): Date {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    throw new Error("Invalid SoundSpa Basic trial period.");
  }
  return new Date(startsAt.getTime() + durationDays * DAY_MS);
}
