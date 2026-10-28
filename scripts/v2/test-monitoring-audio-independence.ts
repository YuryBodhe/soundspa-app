import assert from "node:assert/strict";
import { Mp3Engine } from "../../app/lib/audio/mp3Engine";
import { AmbientEngine } from "../../app/lib/audio/ambientEngine";
import { observeLaneProgress, PlayerMonitoringSidecar, type MonitoringSendResult, type MonitoringSnapshot, type ProgressTracker } from "../../app/v2/playerMonitoring";

// Exercise real engine lifecycles with disposable media elements, never a salon/device.
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src: string; preload = ""; paused = true; ended = false; error = null;
  currentTime = 0; duration = 300; readyState = 3; networkState = 1;
  muted = false; volume = 1; loop = false; seeking = false; pauseCalls = 0;
  buffered = { length: 1, start: () => 0, end: () => 300 };
  constructor(src = "") { super(); this.src = src; FakeAudio.instances.push(this); }
  async play() { this.paused = false; this.dispatchEvent(new Event("playing")); }
  pause() { this.paused = true; this.pauseCalls++; }
  load() { this.currentTime = 0; this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
}
Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "monitoring-isolation-test" }, configurable: true });
Object.defineProperty(globalThis, "Audio", { value: FakeAudio, configurable: true });
Object.defineProperty(globalThis, "HTMLMediaElement", { value: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3, NETWORK_LOADING: 2 }, configurable: true });
Object.defineProperty(globalThis, "fetch", { value: async () => new Response(new Blob(["test-audio"])), configurable: true });
Object.defineProperty(URL, "createObjectURL", { value: () => "blob:test-audio", configurable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const tracker = (): ProgressTracker => ({ key: null, position: null, sampledAt: null, progressedAt: -Infinity });

async function main() {
  const music = new Mp3Engine([{ id: "m", url: "/music/test.mp3" }]);
  const ambient = new AmbientEngine(false);
  const musicTracker = tracker(); const ambientTracker = tracker();
  let sampledAt = 0;
  let mode: "offline" | "healthy" | "hung" | "superseded" = "offline";
  let next: (() => void) | null = null;
  const read = (): MonitoringSnapshot => ({
    music: observeLaneProgress({ status: music.getSnapshot().status, channelId: "music", key: "music/m", ...music.getMonitoringPosition() }, musicTracker, sampledAt),
    ambient: observeLaneProgress({ status: ambient.getSnapshot().status, channelId: "ambient", key: "ambient/a", ...ambient.getMonitoringPosition() }, ambientTracker, sampledAt),
  });
  const sidecar = new PlayerMonitoringSidecar(read, {
    requestTimeoutMs: 5,
    schedule: callback => { next = callback; return 1 as unknown as ReturnType<typeof setTimeout>; },
    cancel: () => { next = null; },
    createSession: async () => { if (mode === "offline") throw new Error("telemetry offline"); return { sessionId: "s", generation: 1 }; },
    sendSignal: async () => mode === "hung" ? new Promise<MonitoringSendResult>(() => {}) : mode === "superseded" ? "superseded" : "accepted",
  });
  const fire = async () => { assert.ok(next); const callback = next; next = null; callback(); await tick(); };
  try {
    await music.play();
    await ambient.togglePlaylist("ambient", [{ id: "a", url: "/noise/test.mp3" }]);
    await tick(); read();
    const active = FakeAudio.instances.filter(audio => !audio.paused);
    assert.equal(active.length, 2, "music and ambient are both playing");
    const pauseCounts = active.map(audio => audio.pauseCalls);
    const advance = () => {
      sampledAt += 1000;
      for (const audio of active) { audio.currentTime++; audio.dispatchEvent(new Event("timeupdate")); }
      // Run the engine's normal buffer sample without waiting for its 500ms timer.
      (music as unknown as { evaluateBufferState: () => void }).evaluateBufferState();
      assert.ok(active.every((audio, index) => !audio.paused && audio.pauseCalls === pauseCounts[index]));
      assert.deepEqual(read(), { music: { state: "playing", channelId: "music" }, ambient: { state: "playing", channelId: "ambient" } });
    };
    advance();
    await sidecar.start(); await tick();
    assert.equal(sidecar.connectionState, "retrying"); advance();
    mode = "healthy"; await fire();
    assert.equal(sidecar.connectionState, "connected"); advance();
    mode = "hung"; await fire();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sidecar.connectionState, "retrying"); advance();
    mode = "healthy"; await fire();
    assert.equal(sidecar.connectionState, "connected"); advance();
    mode = "superseded"; await fire();
    assert.equal(sidecar.connectionState, "superseded"); advance();
    assert.equal(music.getSnapshot().status, "playing");
    assert.equal(ambient.getSnapshot().status, "playing");
    console.info("PASS: real music/ambient engine instances keep playing through telemetry initialization failure, hung request, recovery and session supersession (mock media elements).");
  } finally { sidecar.dispose(); music.dispose(); ambient.dispose(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
