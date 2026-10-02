import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalyticsReportNotFoundError,
  buildAnalyticsReport,
  calculateAnalyticsPeriod,
  isWithinAnalyticsPeriod,
  type AnalyticsReportInput,
  type DeviceDimension,
} from "./analyticsReportModel";

const asOf = new Date("2026-10-02T13:15:59.000Z");
const start = new Date("2026-10-02T12:00:00.000Z");
const inside = new Date("2026-10-02T12:30:00.000Z");
const end = new Date("2026-10-02T13:00:00.000Z");
const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const locA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const locB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deviceA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const deletedDevice = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const unknownDevice = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const channelA = "12345678-1234-4234-8234-123456789012";
const channelB = "87654321-4321-4321-8321-210987654321";

function device(id: string, locationId: string, lastSeenAt: Date | null = new Date("2026-10-02T13:12:00Z")): DeviceDimension {
  return {
    id, locationId, label: id === deviceA ? "Device A" : "Device B", status: "active", activationState: "activated",
    current: true, lastSeenAt, lastPlaybackObservedAt: new Date("2026-10-02T12:45:00Z"),
    music: { state: "paused", channelId: channelA, channelName: "Music A" },
    ambient: { state: "idle", channelId: null, channelName: null },
  };
}

function base(overrides: Partial<AnalyticsReportInput> = {}): AnalyticsReportInput {
  return {
    asOf, period: "24h", scope: { type: "all" },
    organizations: [
      { id: orgA, name: "Org A", archivedAt: null },
      { id: orgB, name: "Org B", archivedAt: null },
    ],
    locations: [
      { id: locA, organizationId: orgA, name: "Location A", archivedAt: null },
      { id: locB, organizationId: orgB, name: "Location B", archivedAt: null },
    ],
    devices: [device(deviceA, locA), device(deviceB, locB)],
    deletedDevices: [], playerActiveBuckets: [], channelPlaybackBuckets: [], errorAggregates: [], lifecycleRecords: [],
    ...overrides,
  };
}

test("UTC completed-hour windows have the expected 1h/24h/7d/30d lengths", () => {
  assert.deepEqual(calculateAnalyticsPeriod(asOf, "1h"), {
    generatedAt: asOf.toISOString(), effectiveStart: "2026-10-02T12:00:00.000Z", effectiveEnd: "2026-10-02T13:00:00.000Z", bucketCount: 1,
  });
  assert.equal(calculateAnalyticsPeriod(asOf, "24h").effectiveStart, "2026-10-01T13:00:00.000Z");
  assert.equal(calculateAnalyticsPeriod(asOf, "7d").effectiveStart, "2026-09-25T13:00:00.000Z");
  assert.equal(calculateAnalyticsPeriod(asOf, "30d").effectiveStart, "2026-09-02T13:00:00.000Z");
  assert.equal(calculateAnalyticsPeriod(asOf, "30d").effectiveEnd, "2026-10-02T13:00:00.000Z");
});

test("effective intervals are half-open [start,end)", () => {
  const window = calculateAnalyticsPeriod(asOf, "1h");
  assert.equal(isWithinAnalyticsPeriod(start, window), true);
  assert.equal(isWithinAnalyticsPeriod(inside, window), true);
  assert.equal(isWithinAnalyticsPeriod(end, window), false);
});

test("all, organization and location scopes are isolated and unknown IDs are typed not-found", () => {
  const input = base({ playerActiveBuckets: [
    { bucketStart: inside, deviceId: deviceA, activePlaybackSeconds: 12 },
    { bucketStart: inside, deviceId: deviceB, activePlaybackSeconds: 30 },
  ] });
  assert.equal(buildAnalyticsReport(input).summary.locationCount, 2);
  assert.equal(buildAnalyticsReport({ ...input, scope: { type: "organization", organizationId: orgA } }).summary.playerActiveSeconds, 12);
  assert.equal(buildAnalyticsReport({ ...input, scope: { type: "location", locationId: locB } }).summary.deviceCount, 1);
  assert.throws(() => buildAnalyticsReport({ ...input, scope: { type: "organization", organizationId: "99999999-9999-4999-8999-999999999999" } }), (error) => error instanceof AnalyticsReportNotFoundError && error.code === "ORGANIZATION_NOT_FOUND");
  assert.throws(() => buildAnalyticsReport({ ...input, scope: { type: "location", locationId: "99999999-9999-4999-8999-999999999999" } }), (error) => error instanceof AnalyticsReportNotFoundError && error.code === "LOCATION_NOT_FOUND");
  assert.throws(() => buildAnalyticsReport({ ...input, scope: { type: "location", locationId: "not-a-uuid" } }), TypeError);
});

test("Player Active is independent of simultaneous Music and Ambient lane totals", () => {
  const report = buildAnalyticsReport(base({
    playerActiveBuckets: [{ bucketStart: inside, deviceId: deviceA, activePlaybackSeconds: 41 }],
    channelPlaybackBuckets: [
      { bucketStart: inside, deviceId: deviceA, channelId: channelA, channelName: "Music A", lane: "music", playedSeconds: 120 },
      { bucketStart: inside, deviceId: deviceA, channelId: channelB, channelName: "Ambient B", lane: "ambient", playedSeconds: 80 },
    ],
  }));
  assert.equal(report.summary.playerActiveSeconds, 41);
  assert.equal(report.summary.musicSeconds, 120);
  assert.equal(report.summary.ambientSeconds, 80);
});

test("multiple channels remain separate and deterministically ordered", () => {
  const report = buildAnalyticsReport(base({ channelPlaybackBuckets: [
    { bucketStart: inside, deviceId: deviceA, channelId: channelA, channelName: "Alpha", lane: "music", playedSeconds: 10 },
    { bucketStart: start, deviceId: deviceA, channelId: channelB, channelName: "Beta", lane: "music", playedSeconds: 20 },
  ] }));
  assert.deepEqual(report.musicUsage.map((row) => [row.channelName, row.playedSeconds]), [["Beta", 20], ["Alpha", 10]]);
});

test("online threshold is inclusive at five minutes; stale and missing state are offline", () => {
  const report = buildAnalyticsReport(base({ devices: [
    device(deviceA, locA, new Date(asOf.getTime() - 300_000)),
    device(deviceB, locB, new Date(asOf.getTime() - 300_001)),
    { ...device("99999999-9999-4999-8999-999999999999", locA), lastSeenAt: null },
  ] }));
  assert.equal(report.summary.onlineDeviceCount, 1);
  assert.equal(report.devices.find((row) => row.deviceId === deviceB)?.online, false);
  assert.equal(report.devices.find((row) => row.lastSeen === null)?.currentMusic.state, "paused");
});

test("zero usage and zero errors are explicit zeroes", () => {
  const report = buildAnalyticsReport(base());
  assert.equal(report.summary.playerActiveSeconds, 0);
  assert.equal(report.summary.musicSeconds, 0);
  assert.equal(report.reliability.totalErrors, 0);
  assert.deepEqual(report.reliability.byCode, []);
});

test("multiple compact error codes aggregate counts, timestamps and distinct affected devices", () => {
  const report = buildAnalyticsReport(base({ errorAggregates: [
    { bucketStart: start, category: "PLAYBACK", code: "MUSIC_PLAYBACK_FAILED", deviceId: deviceA, count: 2, firstSeenAt: start, lastSeenAt: inside },
    { bucketStart: inside, category: "PLAYBACK", code: "MUSIC_PLAYBACK_FAILED", deviceId: deviceB, count: 1, firstSeenAt: inside, lastSeenAt: inside },
    { bucketStart: inside, category: "CATALOG_CONFIG", code: "CUSTOMER_CATALOG_FAILED", deviceId: deviceA, count: 3, firstSeenAt: inside, lastSeenAt: end },
  ] }));
  assert.equal(report.reliability.totalErrors, 6);
  assert.equal(report.reliability.affectedDeviceCount, 2);
  assert.deepEqual(report.reliability.byCode.map(({ code, count, affectedDeviceCount }) => [code, count, affectedDeviceCount]), [
    ["CUSTOMER_CATALOG_FAILED", 3, 1], ["MUSIC_PLAYBACK_FAILED", 3, 2],
  ]);
  assert.equal(report.reliability.byCode[1]?.firstSeen, start.toISOString());
});

test("lifecycle aggregates only event types that currently have writers", () => {
  const types = ["organization_created", "organization_deleted", "location_created", "location_deleted", "device_created", "device_activated", "device_deleted", "device_revoked"];
  const report = buildAnalyticsReport(base({ lifecycleRecords: types.map((eventType) => ({
    eventType, occurredAt: inside, organizationId: orgA, organizationName: "Org A", locationId: locA, locationName: "Location A", deviceId: deviceA, deviceLabel: "Device A",
  })) }));
  assert.deepEqual(report.lifecycle.byType.map((row) => row.eventType), [...types.slice(0, 7)].sort());
});

test("deleted-device snapshots preserve and safely attribute historical usage", () => {
  const report = buildAnalyticsReport(base({
    organizations: [{ id: orgB, name: "Org B", archivedAt: null }],
    locations: [{ id: locB, organizationId: orgB, name: "Location B", archivedAt: null }],
    deletedDevices: [{ id: deletedDevice, deviceLabel: "Removed device", organizationId: orgA, organizationName: "Org A", locationId: locA, locationName: "Former Location", occurredAt: inside }],
    playerActiveBuckets: [{ bucketStart: inside, deviceId: deletedDevice, activePlaybackSeconds: 55 }],
  }));
  const row = report.devices.find((deviceRow) => deviceRow.deviceId === deletedDevice);
  assert.equal(row?.deviceStatus, "deleted");
  assert.equal(row?.organizationName, "Org A");
  assert.equal(row?.locationName, "Former Location");
  assert.equal(row?.playerActiveSeconds, 55);
  assert.equal(report.locations.find((location) => location.locationId === locA)?.playerActiveSeconds, 55);
  assert.equal(report.locations.find((location) => location.locationId === locA)?.status, "deleted");
});

test("unattributable deleted devices and channels retain seconds with safe labels", () => {
  const report = buildAnalyticsReport(base({
    playerActiveBuckets: [{ bucketStart: inside, deviceId: unknownDevice, activePlaybackSeconds: 17 }],
    channelPlaybackBuckets: [{ bucketStart: inside, deviceId: unknownDevice, channelId: channelB, channelName: null, lane: "ambient", playedSeconds: 21 }],
  }));
  assert.equal(report.summary.playerActiveSeconds, 17);
  assert.equal(report.summary.ambientSeconds, 21);
  assert.equal(report.devices.find((row) => row.deviceId === unknownDevice)?.deviceLabel, "Unknown / deleted Device");
  assert.equal(report.ambientUsage[0]?.channelName, "Unknown / deleted channel");
  assert.equal(report.dataQuality.unattributedPlayerActiveSeconds, 17);
  assert.equal(report.dataQuality.unattributedChannelSeconds, 21);
  assert.equal(report.locations.some((row) => row.locationId === locA && row.playerActiveSeconds === 17), false);
});

test("deleted channel usage remains visible for a known Device", () => {
  const report = buildAnalyticsReport(base({ channelPlaybackBuckets: [{
    bucketStart: inside, deviceId: deviceA, channelId: channelB, channelName: null, lane: "music", playedSeconds: 33,
  }] }));
  assert.deepEqual(report.musicUsage, [{ channelId: channelB, channelName: "Unknown / deleted channel", playedSeconds: 33 }]);
  assert.equal(report.summary.musicSeconds, 33);
});
