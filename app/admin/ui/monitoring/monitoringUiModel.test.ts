import assert from "node:assert/strict";
import test from "node:test";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";
import { buildMonitoringLocationRows, filterMonitoringLocations, formatMonitoringRelativeTime, getMonitoringLocationStatus } from "./monitoringUiModel";

const asOf = "2026-10-02T13:15:00.000Z";
const time = (secondsAgo: number) => new Date(Date.parse(asOf) - secondsAgo * 1000).toISOString();

function makeSnapshot(): MonitoringSnapshotV1 {
  const device = (id: string, label: string, online: boolean, playing: boolean, age = 30): MonitoringSnapshotV1["organizations"][number]["locations"][number]["devices"][number] => ({
    id, label, status: "active", activationState: "activated", online, lastSeenAt: online ? time(age) : time(400),
    lastPlaybackObservedAt: null, playerActiveNow: playing, music: { state: "idle", channelId: null, channelName: null },
    ambient: { state: "idle", channelId: null, channelName: null },
  });
  return {
    asOf, onlineThresholdSeconds: 300,
    summary: { organizationCount: 3, locationCount: 5, deviceCount: 6, onlineDeviceCount: 3, playingDeviceCount: 2 },
    organizations: [
      { id: "org-a", name: "Viet Spa", archived: false, locations: [
        { id: "loc-no-devices", name: "Empty", archived: false, devices: [] },
        { id: "loc-online-playing", name: "Lotus", archived: false, devices: [device("d1", "Front Desk", true, true)] },
      ] },
      { id: "org-b", name: "SoundSpa Test", archived: false, locations: [
        { id: "loc-partial", name: "Partial", archived: false, devices: [device("d2", "Reception", true, false), device("d3", "Room 2", false, false)] },
        { id: "loc-offline", name: "Danang", archived: false, devices: [device("d4", "Danang Player", false, true)] },
      ] },
      { id: "org-c", name: "Lotus Spa Moscow", archived: false, locations: [
        { id: "loc-online-idle", name: "Moscow", archived: false, devices: [device("d5", "Lobby", true, false, 240), device("d6", "Spa Room", true, false, 70)] },
      ] },
    ],
  };
}

test("Location status handles empty, offline, partial and fully online sets", () => {
  assert.deepEqual([
    getMonitoringLocationStatus(0, 0), getMonitoringLocationStatus(2, 0),
    getMonitoringLocationStatus(3, 1), getMonitoringLocationStatus(3, 3),
  ], ["No Devices", "Offline", "Partially Online", "Online"]);
});

test("Location rows prioritize offline, partial, online idle, playing, then empty", () => {
  const rows = buildMonitoringLocationRows(makeSnapshot());
  assert.deepEqual(rows.map((row) => row.location.id), ["loc-offline", "loc-partial", "loc-online-idle", "loc-online-playing", "loc-no-devices"]);
  assert.equal(rows[1]?.onlineCount, 1);
  assert.equal(rows[3]?.playingCount, 1);
  assert.equal(rows[2]?.lastSeenAt, time(70));
});

test("search matches Organization, Location and any Device label", () => {
  const rows = buildMonitoringLocationRows(makeSnapshot());
  assert.deepEqual(filterMonitoringLocations(rows, "viet spa", "all").map((row) => row.location.id), ["loc-online-playing", "loc-no-devices"]);
  assert.deepEqual(filterMonitoringLocations(rows, "danang", "all").map((row) => row.location.id), ["loc-offline"]);
  assert.deepEqual(filterMonitoringLocations(rows, "room 2", "all").map((row) => row.location.id), ["loc-partial"]);
});

test("quick filters distinguish offline, partial, playing and not playing", () => {
  const rows = buildMonitoringLocationRows(makeSnapshot());
  assert.deepEqual(filterMonitoringLocations(rows, "", "offline").map((row) => row.location.id), ["loc-offline"]);
  assert.deepEqual(filterMonitoringLocations(rows, "", "partially-online").map((row) => row.location.id), ["loc-partial"]);
  assert.deepEqual(filterMonitoringLocations(rows, "", "playing").map((row) => row.location.id), ["loc-offline", "loc-online-playing"]);
  assert.deepEqual(filterMonitoringLocations(rows, "", "not-playing").map((row) => row.location.id), ["loc-partial", "loc-online-idle", "loc-no-devices"]);
});

test("relative time uses the supplied snapshot asOf and keeps exact absence safe", () => {
  assert.equal(formatMonitoringRelativeTime(time(32), asOf), "32 sec ago");
  assert.equal(formatMonitoringRelativeTime(time(4 * 60), asOf), "4 min ago");
  assert.equal(formatMonitoringRelativeTime(time(72 * 60), asOf), "1 h 12 min ago");
  assert.equal(formatMonitoringRelativeTime(null, asOf), "—");
});
