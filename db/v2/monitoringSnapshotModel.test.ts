import assert from "node:assert/strict";
import test from "node:test";
import { buildMonitoringSnapshot, resolveMonitoringChannelName, type MonitoringDeviceInput, type MonitoringOrganizationInput } from "./monitoringSnapshotModel";

const asOf = new Date("2026-10-02T13:15:00.000Z");
const orgId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const atFiveMinutes = new Date(asOf.getTime() - 300_000);
const overFiveMinutes = new Date(asOf.getTime() - 300_001);
const musicPlaying = { state: "playing" as const, channelId, channelName: "432 Hz" };
const ambientPlaying = { state: "playing" as const, channelId: "44444444-4444-4444-8444-444444444444", channelName: "Forest" };
const idle = { state: "idle" as const, channelId: null, channelName: null };

function device(id: string, overrides: Partial<MonitoringDeviceInput> = {}): MonitoringDeviceInput {
  return {
    id, label: "Device", status: "active", activationState: "activated",
    lastSeenAt: atFiveMinutes, lastPlaybackObservedAt: null,
    music: idle, ambient: idle, ...overrides,
  };
}

function org(locations: MonitoringOrganizationInput["locations"] = []): MonitoringOrganizationInput[] {
  return [{ id: orgId, name: "Organization", archived: false, locations }];
}

test("returns Organization → Location → Device hierarchy including an empty Location", () => {
  const snapshot = buildMonitoringSnapshot(asOf, org([
    { id: locationId, name: "Location", archived: false, devices: [device("device-1")] },
    { id: "empty-location", name: "Empty", archived: false, devices: [] },
  ]));
  assert.equal(snapshot.organizations[0]?.locations.find((location) => location.id === locationId)?.devices[0]?.label, "Device");
  assert.equal(snapshot.summary.organizationCount, 1);
  assert.equal(snapshot.summary.locationCount, 2);
  assert.equal(snapshot.summary.deviceCount, 1);
  assert.equal(snapshot.organizations[0]?.locations.find((location) => location.id === "empty-location")?.devices.length, 0);
});

test("Online includes exactly five minutes and excludes older or missing state", () => {
  const snapshot = buildMonitoringSnapshot(asOf, org([{ id: locationId, name: "Location", archived: false, devices: [
    device("online", { lastSeenAt: atFiveMinutes }),
    device("stale", { lastSeenAt: overFiveMinutes }),
    device("no-state", { lastSeenAt: null }),
  ] }]));
  const devices = new Map(snapshot.organizations[0]?.locations[0]?.devices.map((row) => [row.id, row.online]));
  assert.deepEqual([devices.get("online"), devices.get("stale"), devices.get("no-state")], [true, false, false]);
  assert.equal(snapshot.summary.onlineDeviceCount, 1);
  assert.equal(snapshot.onlineThresholdSeconds, 300);
});

test("Player Active is Music OR Ambient playing across Music-only, Ambient-only, both and neither", () => {
  const snapshot = buildMonitoringSnapshot(asOf, org([{ id: locationId, name: "Location", archived: false, devices: [
    device("music", { music: musicPlaying }),
    device("ambient", { ambient: ambientPlaying }),
    device("both", { music: musicPlaying, ambient: ambientPlaying }),
    device("neither"),
  ] }]));
  const devices = new Map(snapshot.organizations[0]?.locations[0]?.devices.map((row) => [row.id, row.playerActiveNow]));
  assert.deepEqual([devices.get("music"), devices.get("ambient"), devices.get("both"), devices.get("neither")], [true, true, true, false]);
  assert.equal(snapshot.summary.playingDeviceCount, 3);
});

test("Offline Devices retain last-known independent lane state and channels", () => {
  const snapshot = buildMonitoringSnapshot(asOf, org([{ id: locationId, name: "Location", archived: false, devices: [
    device("offline", { lastSeenAt: overFiveMinutes, music: musicPlaying, ambient: { state: "paused", channelId: "ambient-channel", channelName: "Night" } }),
  ] }]));
  const row = snapshot.organizations[0]?.locations[0]?.devices[0];
  assert.equal(row?.online, false);
  assert.equal(row?.playerActiveNow, true);
  assert.deepEqual(row?.music, musicPlaying);
  assert.equal(row?.ambient.state, "paused");
});

test("pending/active Devices without current state are safe and do not leak credentials", () => {
  const pending = { ...device("pending", { activationState: "pending", lastSeenAt: null, lastPlaybackObservedAt: null, music: { state: null, channelId: null, channelName: null }, ambient: { state: null, channelId: null, channelName: null } }), credentialHash: "not-for-dto", activationToken: "not-for-dto" } as MonitoringDeviceInput;
  const active = device("active-no-state", { lastSeenAt: null, music: { state: null, channelId: null, channelName: null }, ambient: { state: null, channelId: null, channelName: null } });
  const snapshot = buildMonitoringSnapshot(asOf, org([{ id: locationId, name: "Location", archived: false, devices: [pending, active] }]));
  const pendingDto = snapshot.organizations[0]?.locations[0]?.devices.find((row) => row.id === "pending");
  assert.equal(pendingDto?.activationState, "pending");
  assert.equal(pendingDto?.online, false);
  assert.equal(pendingDto?.music.state, null);
  assert.equal(pendingDto?.lastPlaybackObservedAt, null);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("credentialHash"), false);
  assert.equal(serialized.includes("activationToken"), false);
  assert.equal(serialized.includes("not-for-dto"), false);
});

test("Organizations without Locations and an entirely empty catalog are represented cleanly", () => {
  const snapshot = buildMonitoringSnapshot(asOf, org());
  assert.equal(snapshot.organizations[0]?.locations.length, 0);
  assert.equal(snapshot.summary.locationCount, 0);
  assert.equal(snapshot.summary.deviceCount, 0);
  assert.deepEqual(buildMonitoringSnapshot(asOf, []).organizations, []);
});

test("revoked status is independent from Online and missing current-channel names remain safe", () => {
  const snapshot = buildMonitoringSnapshot(asOf, org([{ id: locationId, name: "Location", archived: false, devices: [
    device("revoked", { status: "revoked", activationState: "revoked", music: { state: "paused", channelId: channelId, channelName: null } }),
  ] }]));
  const row = snapshot.organizations[0]?.locations[0]?.devices[0];
  assert.equal(row?.status, "revoked");
  assert.equal(row?.online, true);
  assert.equal(resolveMonitoringChannelName(row?.music.channelId ?? null, row?.music.channelName ?? null), "Unknown / deleted channel");
  assert.equal(resolveMonitoringChannelName(null, "ignored"), null);
});
