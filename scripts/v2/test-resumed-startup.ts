import assert from "node:assert/strict";
import { setMaxListeners } from "node:events";
import { Mp3Engine } from "../../app/lib/audio/mp3Engine";
import { MusicSessionCache } from "../../app/lib/audio/musicSessionCache";
import { MusicResumeStore } from "../../app/lib/audio/musicResumeStore";

let now = 0;
Object.defineProperty(performance, "now", { value: () => now, configurable: true });
const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();
const nativeTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((callback: () => void, delay?: number) => {
  const timer = nativeTimeout(callback, delay);
  callbacks.set(timer, callback);
  return timer;
}) as typeof setTimeout;

class TestAudio extends EventTarget {
  src = ""; preload = ""; muted = false; paused = true; seeking = false;
  currentTime = 0; duration = 1800; readyState = 3; networkState = 1;
  error: unknown = null; ended = false; playCalls = 0; ahead = 2;
  ranges: Array<{ start: number; end: number }> | null = null;
  buffered: { readonly length: number; start: (index: number) => number; end: (index: number) => number };
  constructor() {
    super();
    const thisAudio = this;
    this.buffered = {
      get length() { return thisAudio.ranges?.length ?? 1; },
      start: (index) => thisAudio.ranges?.[index]?.start ?? Math.max(0, thisAudio.currentTime - 0.1),
      end: (index) => thisAudio.ranges?.[index]?.end ?? thisAudio.currentTime + thisAudio.ahead,
    };
  }
  load() { this.currentTime = 0; this.paused = true; }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ""; }
  async play() { this.playCalls++; this.paused = false; }
}
const browser = new EventTarget();
const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
Object.assign(globalThis, { window: browser, document: doc, Audio: TestAudio, HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4, NETWORK_LOADING: 2 } });
setMaxListeners(0, browser, doc);
type Internal = {
  audio: TestAudio; phase: string; sourceHasProgressed: boolean; sourceVersion: number;
  networkRecoveryTarget: { trackIndex: number; position: number } | null;
  networkRetryTimer: ReturnType<typeof setTimeout> | null;
  resumeBufferMiss: unknown;
  fastResumeRecoveryAttempts: number;
  evaluateBufferState: () => void;
  confirmDeadNetworkSource: (target: { trackIndex: number; position: number }) => void;
};
const engines: Mp3Engine[] = [];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function create(position: number, ahead = 2) {
  const store = new MusicResumeStore(() => null);
  store.write("channel", "track", position);
  const engine = new Mp3Engine([{ id: "track", url: "/music/test.mp3" }], new MusicSessionCache(), { channelId: "channel", store });
  engines.push(engine);
  await engine.play();
  const state = engine as unknown as Internal;
  state.audio.ahead = ahead;
  state.evaluateBufferState();
  return { engine, state };
}
async function fastRecover(position = 506.378) {
  const result = await create(position, 0);
  result.state.audio.ranges = [{ start: 0, end: 1.776 }];
  result.state.evaluateBufferState(); now += 3000; result.state.evaluateBufferState(); await flush();
  return result;
}
async function main() {
  try {
    const zero = await create(0); now += 3500; zero.state.evaluateBufferState();
    assert.equal(zero.state.audio.playCalls, 1);
    const resumed = await create(120);
    assert.equal(resumed.state.audio.playCalls, 0);
    now += 3500; resumed.state.evaluateBufferState();
    assert.equal(resumed.state.audio.playCalls, 1);
    assert.equal(resumed.state.audio.currentTime, 120);
    assert.equal(resumed.state.sourceHasProgressed, false);

    const stalled = await create(240);
    stalled.state.audio.dispatchEvent(new Event("stalled"));
    assert.deepEqual(stalled.state.networkRecoveryTarget, { trackIndex: 0, position: 240 });
    assert(stalled.state.networkRetryTimer);
    now += 3500; stalled.state.evaluateBufferState();
    assert.equal(stalled.state.audio.playCalls, 1); // Matching provisional resumed recovery qualifies.
    assert.equal(stalled.state.networkRetryTimer, null);
    assert(stalled.state.networkRecoveryTarget); // Retained as failure context until real progression.

    const dead = await create(360);
    dead.state.audio.dispatchEvent(new Event("stalled"));
    dead.state.confirmDeadNetworkSource(dead.state.networkRecoveryTarget!);
    now += 3500; dead.state.evaluateBufferState();
    assert.equal(dead.state.audio.playCalls, 0);
    const retry = callbacks.get(dead.state.networkRetryTimer!); assert(retry);
    clearTimeout(dead.state.networkRetryTimer!); // Invoke the captured callback deterministically, without leaving its real timer live.
    retry(); await flush();
    assert.equal(dead.state.audio.currentTime, 360);
    assert(dead.state.networkRecoveryTarget); // Dead-source recreation retains intended position.

    const normal = await create(480, 8);
    assert.equal(normal.state.audio.playCalls, 1); // No plateau delay for the normal >=5s path.
    normal.state.audio.currentTime = 481; normal.state.evaluateBufferState();
    assert.equal(normal.state.sourceHasProgressed, true);
    assert.equal(normal.state.phase, "audible-network");
    normal.state.audio.dispatchEvent(new Event("waiting"));
    assert.equal(normal.state.networkRetryTimer, null); // Existing audible handoff grace, not pre-start recovery.
    normal.engine.pause(); await normal.engine.play(); normal.state.audio.dispatchEvent(new Event("stalled"));
    assert.equal(normal.state.sourceHasProgressed, true);
    assert.equal(normal.state.networkRetryTimer, null);

    // Safari can report only the initial [0, ~1.8s] range after seeking to a
    // restored position. One bounded fast recovery must replace that source
    // well before the ordinary first 15s network-retry tier, preserving intent.
    const safariResume = await create(506.378, 0);
    const firstSafariAudio = safariResume.state.audio;
    firstSafariAudio.ranges = [{ start: 0, end: 1.776 }];
    safariResume.state.evaluateBufferState();
    assert.equal(firstSafariAudio.playCalls, 0);
    now += 2999; safariResume.state.evaluateBufferState();
    assert.equal(safariResume.state.audio, firstSafariAudio);
    now += 1; safariResume.state.evaluateBufferState(); await flush();
    assert.notEqual(safariResume.state.audio, firstSafariAudio);
    assert.equal(safariResume.state.audio.currentTime, 506.378);
    assert.equal(safariResume.state.fastResumeRecoveryAttempts, 1);
    assert.equal(safariResume.state.audio.playCalls, 0);
    // A second unusable range cannot cause another fast recreation; ordinary
    // stalled recovery remains available as the bounded fallback.
    safariResume.state.audio.ranges = [{ start: 0, end: 1.776 }];
    now += 4000; safariResume.state.evaluateBufferState(); await flush();
    assert.equal(safariResume.state.fastResumeRecoveryAttempts, 1);
    safariResume.state.audio.dispatchEvent(new Event("stalled"));
    assert(safariResume.state.networkRetryTimer);

    const promptResume = await create(540, 8);
    const promptAudio = promptResume.state.audio;
    promptAudio.ranges = [{ start: 540, end: 548 }];
    promptResume.state.evaluateBufferState();
    assert.equal(promptAudio.playCalls, 1);
    now += 3500; promptResume.state.evaluateBufferState();
    assert.equal(promptResume.state.audio, promptAudio);

    const pausedMiss = await create(600, 0);
    const pausedMissAudio = pausedMiss.state.audio;
    pausedMissAudio.ranges = [{ start: 0, end: 1.776 }];
    pausedMiss.state.evaluateBufferState(); now += 2000;
    pausedMiss.state.evaluateBufferState(); pausedMiss.engine.pause(); now += 5000;
    pausedMiss.state.evaluateBufferState();
    assert.equal(pausedMiss.state.audio, pausedMissAudio);
    assert.equal(pausedMiss.state.audio.playCalls, 0);

    // Phase 2: only the recreated source from the one bounded Phase 1
    // recovery may skip the generic empty-TimeRanges grace after a fresh,
    // post-seek readiness event.
    const phase2 = await fastRecover();
    const phase2Audio = phase2.state.audio;
    assert.equal(phase2Audio.currentTime, 506.378);
    phase2Audio.readyState = 4; phase2Audio.ranges = [];
    phase2Audio.dispatchEvent(new Event("canplaythrough")); await flush();
    assert.equal(phase2Audio.playCalls, 1);
    assert.equal(phase2.state.phase, "starting-audible");
    assert.equal(phase2.engine.getSnapshot().status, "loading", "play() resolution alone is not progression");
    assert.equal(phase2Audio.currentTime, 506.378);
    phase2Audio.currentTime += 0.5; phase2.state.evaluateBufferState();
    assert.equal(phase2.engine.getSnapshot().status, "playing");
    assert.equal(phase2.state.networkRecoveryTarget, null);

    const insufficient = await fastRecover();
    insufficient.state.audio.ranges = []; insufficient.state.audio.readyState = 3;
    insufficient.state.audio.dispatchEvent(new Event("canplaythrough")); now += 3500; insufficient.state.evaluateBufferState();
    assert.equal(insufficient.state.audio.playCalls, 0, "readyState below HAVE_ENOUGH_DATA keeps the generic guard");

    const stillSeeking = await fastRecover();
    stillSeeking.state.audio.ranges = []; stillSeeking.state.audio.readyState = 4; stillSeeking.state.audio.seeking = true;
    stillSeeking.state.audio.dispatchEvent(new Event("canplaythrough")); now += 3500; stillSeeking.state.evaluateBufferState();
    assert.equal(stillSeeking.state.audio.playCalls, 0, "a source still seeking cannot use the accelerated path");

    const errored = await fastRecover();
    errored.state.audio.ranges = []; errored.state.audio.readyState = 4; errored.state.audio.error = new Error("decode error");
    errored.state.audio.dispatchEvent(new Event("canplaythrough")); now += 3500; errored.state.evaluateBufferState();
    assert.equal(errored.state.audio.playCalls, 0, "a media error cannot use the accelerated path");

    const mismatched = await fastRecover();
    mismatched.state.audio.ranges = []; mismatched.state.audio.readyState = 4;
    mismatched.state.networkRecoveryTarget!.position += 1;
    mismatched.state.audio.dispatchEvent(new Event("canplaythrough")); now += 3500; mismatched.state.evaluateBufferState();
    assert.equal(mismatched.state.audio.playCalls, 0, "a mismatched recovery target cannot use the accelerated path");

    const pausedPhase2 = await fastRecover();
    const pausedPhase2Audio = pausedPhase2.state.audio;
    pausedPhase2Audio.ranges = []; pausedPhase2Audio.readyState = 4; pausedPhase2.engine.pause();
    pausedPhase2Audio.dispatchEvent(new Event("canplaythrough")); now += 3500; pausedPhase2.state.evaluateBufferState();
    assert.equal(pausedPhase2Audio.playCalls, 0, "Pause wins over accelerated readiness");

    const stalePhase2 = await fastRecover();
    const stalePhase2Audio = stalePhase2.state.audio;
    stalePhase2Audio.ranges = []; stalePhase2Audio.readyState = 4;
    stalePhase2.engine.dispose(); stalePhase2Audio.dispatchEvent(new Event("canplaythrough"));
    assert.equal(stalePhase2Audio.playCalls, 0, "dispose invalidates accelerated readiness");

    const noProgress = await fastRecover();
    noProgress.state.audio.ranges = []; noProgress.state.audio.readyState = 4;
    noProgress.state.audio.dispatchEvent(new Event("canplay")); await flush();
    assert.equal(noProgress.state.audio.playCalls, 1);
    assert.equal(noProgress.engine.getSnapshot().status, "loading");
    now += 3001; noProgress.state.evaluateBufferState();
    assert.equal(noProgress.state.sourceHasProgressed, false);
    assert(noProgress.state.networkRetryTimer, "non-progress after provisional play retains ordinary network recovery");

    const seeking = await create(600);
    seeking.state.audio.currentTime = 601; seeking.state.audio.seeking = true;
    seeking.state.evaluateBufferState(); assert.equal(seeking.state.sourceHasProgressed, false);
    now += 3500; seeking.state.evaluateBufferState(); assert.equal(seeking.state.audio.playCalls, 0);

    const stale = await create(720);
    stale.state.audio.dispatchEvent(new Event("stalled"));
    const staleRetry = callbacks.get(stale.state.networkRetryTimer!); assert(staleRetry);
    const oldAudio = stale.state.audio; stale.engine.dispose();
    const next = await create(840); const version = next.state.sourceVersion;
    staleRetry(); oldAudio.dispatchEvent(new Event("stalled")); oldAudio.dispatchEvent(new Event("progress"));
    await flush();
    assert.equal(next.state.sourceVersion, version); assert.equal(next.state.audio.playCalls, 0);
    assert.equal(next.state.networkRecoveryTarget, null); assert.equal(oldAudio.playCalls, 0);
    console.info("PASS: zero/resumed plateau; bounded Safari stale-range recovery; readiness-gated accelerated provisional start; real progression remains required; insufficient-readyState/seeking/error/target-mismatch/Pause/dispose guards; no-progression retains generic recovery; normal resume and fast-retry bounds; dead-source and stale-generation protections.");
  } finally { engines.forEach(engine => engine.dispose()); callbacks.clear(); globalThis.setTimeout = nativeTimeout; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
