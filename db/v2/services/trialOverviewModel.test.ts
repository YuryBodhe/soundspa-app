import assert from "node:assert/strict";
import test from "node:test";
import { buildManualTrialOverview, type ManualTrialOverviewRecord } from "./trialOverviewModel";

const now = new Date("2026-11-08T06:00:00.000Z");
function trial(overrides: Partial<ManualTrialOverviewRecord> = {}): ManualTrialOverviewRecord {
  return {
    id: "trial-1", organizationName: "SoundSpa E2E Test 01", locationName: "Salon E2E Test 01",
    productName: "SoundSpa Basic", trialStatus: "active", startsAt: new Date("2026-11-08T05:40:00.000Z"),
    endsAt: new Date("2026-12-06T05:40:00.000Z"), invalidatedByResetId: null,
    organizationArchivedAt: null, locationArchivedAt: null, ...overrides,
  };
}

test("trial overview labels active, upcoming and expired periods from stored state and server time", () => {
  const rows = buildManualTrialOverview([
    trial(),
    trial({ id: "upcoming", startsAt: new Date("2026-11-09T00:00:00.000Z") }),
    trial({ id: "date-expired", endsAt: new Date("2026-11-08T05:59:59.000Z") }),
    trial({ id: "status-expired", trialStatus: "expired", endsAt: new Date("2026-12-01T00:00:00.000Z") }),
  ], now);
  assert.deepEqual(rows.map(({ id, status }) => [id, status]), [
    ["trial-1", "Active"], ["upcoming", "Upcoming"], ["date-expired", "Expired"], ["status-expired", "Expired"],
  ]);
  assert.equal(rows[0].endsAt, "2026-12-06T05:40:00.000Z");
});

test("trial overview excludes invalidated trials and trials belonging to archived organizations or locations", () => {
  const rows = buildManualTrialOverview([
    trial(),
    trial({ id: "invalidated", invalidatedByResetId: "reset-1" }),
    trial({ id: "archived-org", organizationArchivedAt: new Date("2026-11-01T00:00:00.000Z") }),
    trial({ id: "archived-location", locationArchivedAt: new Date("2026-11-01T00:00:00.000Z") }),
  ], now);
  assert.deepEqual(rows.map(({ id }) => id), ["trial-1"]);
});

test("empty trial history produces an empty list", () => {
  assert.deepEqual(buildManualTrialOverview([], now), []);
});
