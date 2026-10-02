import assert from "node:assert/strict";
import test from "node:test";
import { currentLaneDisplay, formatAnalyticsDuration, formatAnalyticsRelativeTime, formatAnalyticsScope, formatAnalyticsUtc, lifecycleEventLabel } from "./analyticsPresentation";

test("duration formatting keeps integer seconds readable without changing source values", () => {
  assert.deepEqual([formatAnalyticsDuration(45), formatAnalyticsDuration(224), formatAnalyticsDuration(67320), formatAnalyticsDuration(183600)], ["45 sec", "3 min 44 sec", "18 h 42 min", "2 d 3 h"]);
  assert.equal(formatAnalyticsDuration(Number.NaN), "0 sec");
});

test("relative timestamps are deterministic against the supplied report time", () => {
  const asOf = "2026-10-02T13:15:00.000Z";
  assert.equal(formatAnalyticsRelativeTime("2026-10-02T13:14:28.000Z", asOf), "32 sec ago");
  assert.equal(formatAnalyticsRelativeTime("2026-10-02T12:43:00.000Z", asOf), "32 min ago");
  assert.equal(formatAnalyticsRelativeTime(null, asOf), "—");
  assert.equal(formatAnalyticsUtc("2026-10-02T12:00:00.000Z"), "2026-10-02 12:00 UTC");
});

test("scope and lifecycle labels are resolved from real selector data", () => {
  const options = { organizations: [{ id: "org", name: "Viet Spa" }], locations: [{ id: "loc", name: "Danang", organizationId: "org" }] };
  assert.equal(formatAnalyticsScope({ type: "all" }, options), "All Organizations");
  assert.equal(formatAnalyticsScope({ type: "organization", organizationId: "org" }, options), "Viet Spa");
  assert.equal(formatAnalyticsScope({ type: "location", locationId: "loc" }, options), "Danang · Viet Spa");
  assert.equal(lifecycleEventLabel("device_activated"), "Device Activated");
});

test("offline lane presentation explicitly marks state as last known", () => {
  const lane = { state: "paused", channelId: "channel", channelName: "Relax" };
  assert.equal(currentLaneDisplay(lane, false), "Last known · paused · Relax");
  assert.equal(currentLaneDisplay(lane, true), "paused · Relax");
});
