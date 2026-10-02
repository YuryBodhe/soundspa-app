import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observeLaneProgress, PlayerMonitoringSidecar, type MonitoringSignal, type MonitoringSnapshot } from "../../app/v2/playerMonitoring";

const realPlayerRoute = readFileSync("app/player/page.tsx", "utf8");
const previewRoute = readFileSync("app/admin/ui/locations/[locationId]/player-preview/page.tsx", "utf8");
const technicalRoute = readFileSync("app/v2/page.tsx", "utf8");
const customerPlayer = readFileSync("app/v2/customerCatalog.tsx", "utf8");
assert.match(realPlayerRoute, /CustomerCatalogPlayer monitoringEnabled/);
assert.doesNotMatch(previewRoute, /monitoringEnabled/);
assert.doesNotMatch(technicalRoute, /monitoringEnabled/);
assert.match(customerPlayer, /monitoringEnabled = false/);

const tracker = { key: null as string | null, position: null as number | null, sampledAt: null as number | null, progressedAt: -Infinity };
assert.deepEqual(observeLaneProgress({ status: "playing", channelId: "music-a", key: "music-a/track-a", currentTime: 20, paused: false, seeking: false }, tracker, 0), { state: "buffering", channelId: "music-a" }, "play() status without observed movement is not playing");
assert.equal(observeLaneProgress({ status: "playing", channelId: "music-a", key: "music-a/track-a", currentTime: 20.2, paused: false, seeking: false }, tracker, 1_000).state, "playing");
assert.equal(observeLaneProgress({ status: "playing", channelId: "music-a", key: "music-a/track-a", currentTime: 21, paused: true, seeking: false }, tracker, 2_000).state, "buffering", "a paused or seeking element is never reported as actually playing");
assert.equal(observeLaneProgress({ status: "paused", channelId: "music-a", key: "music-a/track-a", currentTime: 21, paused: true, seeking: false }, tracker, 2_100).state, "paused");
assert.equal(observeLaneProgress({ status: "playing", channelId: "music-a", key: "music-a/track-b", currentTime: 0, paused: false, seeking: true }, tracker, 3_000).state, "buffering", "seek does not count as playback progression");
assert.equal(observeLaneProgress({ status: "playing", channelId: "music-a", key: "music-a/track-b", currentTime: 100, paused: false, seeking: false }, tracker, 4_000).state, "buffering", "a completed seek jump is not mistaken for progression");
assert.equal(observeLaneProgress({ status: "playing", channelId: "music-a", key: "music-a/track-b", currentTime: 100.3, paused: false, seeking: false }, tracker, 5_000).state, "playing");
assert.equal(observeLaneProgress({ status: "playing", channelId: null, key: null, currentTime: 0, paused: true, seeking: false }, tracker, 5_000).state, "idle");

const base: MonitoringSnapshot = {
  music: { state: "idle", channelId: "music-a" },
  ambient: { state: "idle", channelId: null },
};
async function main() {
let releaseFirst!: (ok: boolean) => void;
let active = 0;
let maximumActive = 0;
const sent: MonitoringSignal[] = [];
const sidecar = new PlayerMonitoringSidecar(() => base, {
  createSession: async () => ({ sessionId: "session", generation: 3 }),
  sendSignal: async (signal) => {
    sent.push(signal);
    active += 1; maximumActive = Math.max(maximumActive, active);
    if (sent.length === 1) {
      const ok = await new Promise<boolean>((resolve) => { releaseFirst = resolve; });
      active -= 1; return ok;
    }
    active -= 1; return true;
  },
  random: () => 0,
});
await sidecar.start();
assert.equal(sent.length, 1, "session establishment sends an initial snapshot");
const second: MonitoringSnapshot = { music: { state: "playing", channelId: "music-b" }, ambient: { state: "idle", channelId: null } };
const third: MonitoringSnapshot = { music: { state: "playing", channelId: "music-c" }, ambient: { state: "playing", channelId: "ambient-a" } };
sidecar.update(second);
sidecar.update(third);
assert.equal(sent.length, 1, "only one signal may be in flight; intermediate pending state coalesces");
releaseFirst(true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(sent.length, 2);
assert.equal(sent[1].music.channelId, "music-c", "latest state is sent after the in-flight request");
assert.equal(sent[1].ambient.state, "playing");
assert.equal(sent[0].music.sequence, 1);
assert.equal(sent[1].music.sequence, 2);
assert.equal(sent[1].ambient.sequence, 2);
assert.equal(maximumActive, 1, "monitoring requests are never concurrent");
sidecar.dispose();

let failureCalls = 0;
const failed = new PlayerMonitoringSidecar(() => base, {
  createSession: async () => ({ sessionId: "session", generation: 1 }),
  sendSignal: async () => { failureCalls += 1; throw new Error("offline"); },
});
await failed.start();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(failureCalls, 1);
failed.update({ music: { state: "paused", channelId: "music-a" }, ambient: { state: "idle", channelId: null } });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(failureCalls, 2, "a later meaningful transition may retry, without a timer loop");
failed.dispose();
console.info("PASS: actual-progression truth, seek exclusion, independent lane snapshots, one-in-flight latest-state coalescing, and silent failure isolation.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
