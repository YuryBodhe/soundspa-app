import assert from "node:assert/strict";
import test from "node:test";
import { planSafeTrialTermination, SOUNDSPA_BASIC_TRIAL_DAYS, soundSpaBasicTrialEndsAt } from "./trialPolicy";

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

test("early termination defers to the natural trial boundary when paid coverage starts there", () => {
  const now = new Date("2026-11-07T13:07:57.018Z");
  const naturalEnd = new Date("2026-11-25T10:28:06.958Z");
  const result = planSafeTrialTermination({ now, naturalTrialEnd: naturalEnd, paidPeriods: [{ startsAt: naturalEnd, endsAt: new Date("2026-12-25T10:28:06.958Z") }] });
  assert.deepEqual(result, { deferredUntil: naturalEnd, paidStartsAt: naturalEnd });
});

test("early termination extends only the trial coverage needed to reach a later paid start", () => {
  const now = new Date("2026-11-07T00:00:00.000Z");
  const naturalEnd = new Date("2026-11-25T00:00:00.000Z");
  const paidStartsAt = new Date("2026-12-01T00:00:00.000Z");
  assert.deepEqual(planSafeTrialTermination({ now, naturalTrialEnd: naturalEnd, paidPeriods: [{ startsAt: paidStartsAt, endsAt: new Date("2027-01-01T00:00:00.000Z") }] }), {
    deferredUntil: paidStartsAt, paidStartsAt,
  });
});

test("current paid coverage through the next period avoids deferring the trial end", () => {
  const now = new Date("2026-11-07T00:00:00.000Z");
  const nextStart = new Date("2026-12-01T00:00:00.000Z");
  const result = planSafeTrialTermination({ now, naturalTrialEnd: new Date("2026-11-25T00:00:00.000Z"), paidPeriods: [
    { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: nextStart },
    { startsAt: nextStart, endsAt: new Date("2027-01-01T00:00:00.000Z") },
  ] });
  assert.equal(result, null);
});

test("half-open paid coverage ending before the next period keeps the trial through the gap", () => {
  const now = new Date("2026-11-07T00:00:00.000Z");
  const naturalEnd = new Date("2026-11-25T00:00:00.000Z");
  const paidStartsAt = new Date("2026-12-01T00:00:00.000Z");
  const result = planSafeTrialTermination({ now, naturalTrialEnd: naturalEnd, paidPeriods: [
    { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-20T00:00:00.000Z") },
    { startsAt: paidStartsAt, endsAt: new Date("2027-01-01T00:00:00.000Z") },
  ] });
  assert.deepEqual(result, { deferredUntil: paidStartsAt, paidStartsAt });
});
