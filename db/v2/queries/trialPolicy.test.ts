import assert from "node:assert/strict";
import test from "node:test";
import { SOUNDSPA_BASIC_TRIAL_DAYS, soundSpaBasicTrialEndsAt } from "./trialPolicy";

test("SoundSpa Basic policy is 28 days and computes the default trial end", () => {
  const startsAt = new Date("2026-10-09T12:00:00.000Z");
  assert.equal(SOUNDSPA_BASIC_TRIAL_DAYS, 28);
  assert.equal(soundSpaBasicTrialEndsAt(startsAt).toISOString(), "2026-11-06T12:00:00.000Z");
});

test("explicit test trial durations are supported and validated", () => {
  const startsAt = new Date("2026-10-09T12:00:00.000Z");
  assert.equal(soundSpaBasicTrialEndsAt(startsAt, 14).toISOString(), "2026-10-23T12:00:00.000Z");
  assert.throws(() => soundSpaBasicTrialEndsAt(startsAt, 0), /Invalid SoundSpa Basic trial period/);
  assert.throws(() => soundSpaBasicTrialEndsAt(new Date(NaN)), /Invalid SoundSpa Basic trial period/);
});
