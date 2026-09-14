import assert from "node:assert/strict";
import { setMaxListeners } from "node:events";
import { Mp3Engine } from "../../app/lib/audio/mp3Engine";
import { MusicSessionCache } from "../../app/lib/audio/musicSessionCache";
import { MusicResumeStore } from "../../app/lib/audio/musicResumeStore";

let now = 0;
Object.defineProperty(performance, "now", { value: () => now, configurable: true });
class TestAudio extends EventTarget {
  src = ""; preload = ""; muted = false; paused = true; seeking = false;
  currentTime = 0; duration = 1800; readyState = 4; networkState = 2;
  error: unknown = null; ended = false; playCalls = 0; ahead = 0; rangeCount = 0;
  mode: "resolve" | "reject" | "pending" = "resolve";
  resolvePlay: (() => void) | null = null;
  buffered = { get length() { return 0; }, start: () => this.currentTime, end: () => this.currentTime + this.ahead };
  constructor() { super(); Object.defineProperty(this.buffered, "length", { get: () => this.rangeCount }); }
  load() { this.currentTime = 0; this.paused = true; }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ""; }
  play() {
    this.playCalls++; this.paused = false;
    if (this.mode === "reject") return Promise.reject(new Error("media play failed"));
    if (this.mode === "pending") return new Promise<void>(resolve => { this.resolvePlay = resolve; });
    return Promise.resolve();
  }
}
const browser = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
Object.assign(globalThis, { window: browser, document: doc, Audio: TestAudio, HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4, NETWORK_LOADING: 2 } });
setMaxListeners(0, browser, doc);
type Internal = { audio: TestAudio; phase: string; sourceVersion: number; generation: number; sourceHasProgressed: boolean;
  networkRecoveryTarget: unknown; networkRetryTimer: ReturnType<typeof setTimeout> | null; deadNetworkSourceVersion: number | null;
  evaluateBufferState: () => void; startNetworkTrack: (index: number, recovering: boolean, position: number) => Promise<void> };
const engines: Mp3Engine[] = [];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function create() {
  const store = new MusicResumeStore(() => null); store.write("channel", "track", 19.085595);
  const engine = new Mp3Engine([{ id: "track", url: "/music/432/test.mp3" }], new MusicSessionCache(), { channelId: "channel", store });
  engines.push(engine); await engine.play(); await flush(); return { engine, state: engine as unknown as Internal };
}
const tick = (state: Internal, milliseconds: number) => { now += milliseconds; state.evaluateBufferState(); };
async function main() {
  try {
    const first = await create(); first.state.audio.dispatchEvent(new Event("stalled")); assert(first.state.networkRetryTimer);
    const original = first.state.audio, version = first.state.sourceVersion; original.mode = "pending";
    tick(first.state, 2999); assert.equal(original.playCalls, 0); tick(first.state, 1);
    assert.equal(original.playCalls, 1); assert.equal(first.state.phase, "starting-audible");
    assert.equal(first.state.networkRetryTimer, null); assert(first.state.networkRecoveryTarget);
    tick(first.state, 1000); assert.equal(original.playCalls, 1); assert.equal(first.state.audio, original); assert.equal(first.state.sourceVersion, version);
    original.resolvePlay!(); await flush(); assert.equal(first.engine.getSnapshot().status, "loading"); assert.equal(first.state.sourceHasProgressed, false);
    original.currentTime += 0.5; first.state.evaluateBufferState(); assert.equal(first.engine.getSnapshot().status, "playing"); assert.equal(first.state.networkRecoveryTarget, null);

    const normal = await create(); normal.state.audio.rangeCount = 1; normal.state.audio.ahead = 8; normal.state.evaluateBufferState(); assert.equal(normal.state.audio.playCalls, 1);
    const plateau = await create(); plateau.state.audio.rangeCount = 1; plateau.state.audio.ahead = 2; plateau.state.evaluateBufferState(); tick(plateau.state, 3000); assert.equal(plateau.state.audio.playCalls, 1);

    const changed = await create(); tick(changed.state, 2500); changed.state.audio.readyState = 3; changed.state.evaluateBufferState();
    tick(changed.state, 1000); assert.equal(changed.state.audio.playCalls, 0); changed.state.audio.readyState = 4; changed.state.evaluateBufferState(); tick(changed.state, 2999); assert.equal(changed.state.audio.playCalls, 0);
    const seek = await create(); tick(seek.state, 2500); seek.state.audio.dispatchEvent(new Event("seeking")); tick(seek.state, 1000); assert.equal(seek.state.audio.playCalls, 0);
    const paused = await create(); tick(paused.state, 2500); paused.engine.pause(); tick(paused.state, 5000); assert.equal(paused.state.audio.playCalls, 0);
    const disposed = await create(); const old = disposed.state.audio; tick(disposed.state, 2500); disposed.engine.dispose(); tick(disposed.state, 5000); old.dispatchEvent(new Event("progress")); assert.equal(old.playCalls, 0);
    const replacement = await create(); const replacedAudio = replacement.state.audio; tick(replacement.state, 2500);
    await replacement.state.startNetworkTrack(0, true, 19.085595); replacedAudio.dispatchEvent(new Event("progress")); tick(replacement.state, 1000); assert.equal(replacedAudio.playCalls, 0); assert.equal(replacement.state.audio.playCalls, 0);
    const generation = await create(); tick(generation.state, 2500); generation.state.generation++; tick(generation.state, 1000); assert.equal(generation.state.audio.playCalls, 0);
    const rejected = await create(); rejected.state.audio.mode = "reject"; tick(rejected.state, 3000); await flush();
    assert.equal(rejected.state.deadNetworkSourceVersion, rejected.state.sourceVersion); assert(rejected.state.networkRetryTimer); assert(rejected.state.networkRecoveryTarget);
    const frozen = await create(); tick(frozen.state, 3000); await flush(); tick(frozen.state, 3001); assert.equal(frozen.engine.getSnapshot().status, "loading"); assert(frozen.state.networkRetryTimer);
    const pendingPause = await create(); pendingPause.state.audio.mode = "pending"; tick(pendingPause.state, 3000); pendingPause.engine.pause(); pendingPause.state.audio.resolvePlay!(); await flush(); assert.equal(pendingPause.engine.getSnapshot().status, "paused");
    for (const invalidate of [
      (state: Internal) => { state.audio.error = new Error("decode error"); },
      (state: Internal) => { state.audio.ended = true; },
      (state: Internal) => { state.audio.seeking = true; },
      (state: Internal) => { state.audio.currentTime += 2; },
      (state: Internal) => { state.deadNetworkSourceVersion = state.sourceVersion; },
      (state: Internal) => { state.networkRecoveryTarget = { trackIndex: 1, position: 19.085595 }; },
    ]) { const guarded = await create(); tick(guarded.state, 2500); invalidate(guarded.state); tick(guarded.state, 4000); assert.equal(guarded.state.audio.playCalls, 0); }
    console.info("PASS: Trace04 empty ranges; 3s continuous guards; exactly one play; same-source retry cancelled; resolved != success; real progression cleanup; normal/plateau unchanged; readyState3 excluded; seek/Pause/dispose/replacement/generation invalidation; rejection/freeze recovery; Pause wins over pending play.");
  } finally { engines.forEach(engine => engine.dispose()); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
