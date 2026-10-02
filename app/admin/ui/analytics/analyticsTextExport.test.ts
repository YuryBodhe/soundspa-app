import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyticsReportV1 } from "../../../../db/v2/analyticsReportModel";
import { analyticsReportStateReducer, INITIAL_ANALYTICS_REPORT_STATE } from "./analyticsReportState";
import { createAnalyticsTextDownload, formatAnalyticsReportFilename, formatAnalyticsReportText } from "./analyticsTextExport";

function makeReport(overrides: Partial<AnalyticsReportV1> = {}): AnalyticsReportV1 {
  return {
    metadata: { version: 1, generatedAt: "2026-10-02T13:15:00.000Z", scope: { type: "all" }, requestedPeriod: "24h", effectiveStart: "2026-10-01T13:00:00.000Z", effectiveEnd: "2026-10-02T13:00:00.000Z", timezone: "UTC", granularity: "hour", interval: "[effectiveStart, effectiveEnd)" },
    summary: { organizationCount: 1, locationCount: 1, deviceCount: 1, onlineDeviceCount: 1, playerActiveSeconds: 224, musicSeconds: 67320, ambientSeconds: 183600, errorCount: 0 },
    locations: [{ organizationId: "org-uuid-secret", organizationName: "Lotus Spa Moscow", locationId: "location-uuid-secret", locationName: "Lotus Spa", status: "current", playerActiveSeconds: 224, musicSeconds: 224, ambientSeconds: 0, deviceCount: 1, onlineDeviceCount: 1, lastSeen: "2026-10-02T12:59:00.000Z", lastPlaybackObserved: null }],
    musicUsage: [{ channelId: "music-id", channelName: "Piano Moods", playedSeconds: 224 }],
    ambientUsage: [{ channelId: "ambient-id", channelName: "Forest", playedSeconds: 45 }],
    devices: [{ organizationId: "org-uuid-secret", organizationName: "Lotus Spa Moscow", locationId: "location-uuid-secret", locationName: "Lotus Spa", deviceId: "device-uuid-secret", deviceLabel: "Front Desk", deviceStatus: "active", activationState: "activated", online: true, lastSeen: "2026-10-02T12:59:00.000Z", lastPlaybackObserved: null, currentMusic: { state: "paused", channelId: "music-id", channelName: "Piano Moods" }, currentAmbient: { state: "idle", channelId: "ambient-id", channelName: "Forest" }, playerActiveSeconds: 224 }],
    reliability: { totalErrors: 1, affectedDeviceCount: 1, byCode: [{ category: "player", code: "MEDIA_STALL", count: 1, firstSeen: "2026-10-02T12:00:00.000Z", lastSeen: "2026-10-02T12:01:00.000Z", affectedDeviceCount: 1 }] },
    lifecycle: { byType: [{ eventType: "device_activated", count: 1 }] },
    dataQuality: { hourlyGranularity: "Usage is aggregated into completed UTC-hour buckets.", accountingCaveat: "Player activity is independent from channel totals.", channelTimelineCaveat: "Exact channel-switch timestamps are not available.", unattributedPlayerActiveSeconds: 0, unattributedChannelSeconds: 0, notes: [] },
    ...overrides,
  };
}

test("report text is deterministic, human-readable UTF-8 text with every canonical section", () => {
  const report = makeReport();
  const first = formatAnalyticsReportText(report);
  assert.equal(first, formatAnalyticsReportText(report));
  assert.ok(first.endsWith("\n"));
  assert.match(first, /^SOUNDSPA ANALYTICS REPORT/);
  for (const heading of ["SUMMARY", "LOCATIONS", "MUSIC USAGE", "AMBIENT USAGE", "DEVICES", "RELIABILITY", "LIFECYCLE", "DATA QUALITY"]) assert.ok(first.includes(heading));
  assert.match(first, /3 min 44 sec/);
  assert.match(first, /Piano Moods: 3 min 44 sec/);
  assert.match(first, /Front Desk — Online; active; activation activated/);
  assert.match(first, /Current Music: paused · Piano Moods/);
  assert.match(first, /player \/ MEDIA_STALL: 1; affected Devices: 1/);
  assert.match(first, /Device Activated: 1/);
  assert.match(first, /Music and Ambient are independent lanes/);
  assert.doesNotMatch(first, /org-uuid-secret|location-uuid-secret/);
  assert.doesNotMatch(first.trimStart(), /^\{/);
});

test("scope-specific filenames use safe names, UTC generated date and period without UUIDs", () => {
  const all = makeReport();
  const organization = makeReport({ metadata: { ...all.metadata, scope: { type: "organization", organizationId: "org-uuid-secret" } } });
  const location = makeReport({ metadata: { ...all.metadata, scope: { type: "location", locationId: "location-uuid-secret" } } });
  assert.equal(formatAnalyticsReportFilename(all), "SoundSpa_Report_All_2026-10-02_24h.txt");
  assert.equal(formatAnalyticsReportFilename(organization), "SoundSpa_Report_Lotus_Spa_Moscow_2026-10-02_24h.txt");
  assert.equal(formatAnalyticsReportFilename(location), "SoundSpa_Report_Lotus_Spa_2026-10-02_24h.txt");

  const unsafe = makeReport({ locations: [{ ...all.locations[0]!, locationName: "../ Lotus\\Spa: East?\n" }] });
  const filename = formatAnalyticsReportFilename(makeReport({ metadata: { ...all.metadata, scope: { type: "location", locationId: "location-uuid-secret" } }, locations: unsafe.locations }));
  assert.equal(filename, "SoundSpa_Report_Lotus_Spa_East_2026-10-02_24h.txt");
  assert.doesNotMatch(filename, /[/\\:?*<>|\u0000-\u001f]|uuid/i);
  assert.ok(filename.length < 100);
});

test("duration presentation covers zero, seconds, minutes, hours and multi-day values", () => {
  const base = makeReport();
  const report = makeReport({
    summary: { ...base.summary, playerActiveSeconds: 619200, musicSeconds: 0, ambientSeconds: 0 },
    locations: [{ ...base.locations[0]!, playerActiveSeconds: 0, musicSeconds: 67320, ambientSeconds: 183600 }],
    musicUsage: [{ channelId: "music-id", channelName: "Piano Moods", playedSeconds: 67320 }],
    ambientUsage: [{ channelId: "ambient-id", channelName: "Forest", playedSeconds: 183600 }],
  });
  const text = formatAnalyticsReportText(report);
  assert.match(text, /Player Active: 7 d 4 h/);
  assert.match(text, /Music: 0 sec/);
  assert.match(text, /Ambient: 0 sec/);
  assert.match(text, /Player Active during period: 3 min 44 sec/);
  assert.match(text, /18 h 42 min/);
  assert.match(text, /2 d 3 h/);
});

test("zero-usage and empty sections have explicit readable messages", () => {
  const empty = makeReport({
    summary: { organizationCount: 0, locationCount: 0, deviceCount: 0, onlineDeviceCount: 0, playerActiveSeconds: 0, musicSeconds: 0, ambientSeconds: 0, errorCount: 0 },
    locations: [], musicUsage: [], ambientUsage: [], devices: [],
    reliability: { totalErrors: 0, affectedDeviceCount: 0, byCode: [] }, lifecycle: { byType: [] },
  });
  const text = formatAnalyticsReportText(empty);
  assert.match(text, /No Locations in this report\./);
  assert.match(text, /No music usage during this period\./);
  assert.match(text, /No ambient usage during this period\./);
  assert.match(text, /No Devices in this report\./);
  assert.match(text, /No reported errors during this period\./);
  assert.match(text, /No reported lifecycle events during this period\./);
  assert.match(text, /Effective interval: 2026-10-01 13:00 UTC — 2026-10-02 13:00 UTC/);
});

test("download preparation uses the supplied report only and performs no report request", () => {
  const report = makeReport();
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls++; throw new Error("unexpected report refetch"); }) as typeof fetch;
  try {
    const download = createAnalyticsTextDownload(report);
    assert.equal(download.filename, formatAnalyticsReportFilename(report));
    assert.equal(download.text, formatAnalyticsReportText(report));
    assert.equal(download.mimeType, "text/plain;charset=utf-8");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a new or failed generation clears a prior report so stale export is impossible", () => {
  const report = makeReport();
  const success = analyticsReportStateReducer(INITIAL_ANALYTICS_REPORT_STATE, { type: "generated", report });
  assert.equal(success.report, report);
  const started = analyticsReportStateReducer(success, { type: "generate-started" });
  assert.equal(started.report, null);
  const failed = analyticsReportStateReducer(started, { type: "generation-failed", error: "failed" });
  assert.equal(failed.report, null);
  assert.equal(failed.error, "failed");
});
