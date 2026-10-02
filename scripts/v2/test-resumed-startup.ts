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
  error = null; ended = false; playCalls = 0; ahead = 2;
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
Object.assign(globalThis, { window: browser, document: doc, Audio: TestAudio, HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3, NETWORK_LOADING: 2 } });
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
    console.info("PASS: zero/resumed plateau; bounded Safari stale-range recovery before generic retry; prompt resumed buffer avoids reload; second fast reload prevented while generic recovery remains; Pause cancels eligibility; provisional recovery; dead-source protection; normal >=5s path; real progression excludes pre-start; seeking is not progression; stale retry/events after dispose cannot affect replacement engine.");
  } finally { engines.forEach(engine => engine.dispose()); callbacks.clear(); globalThis.setTimeout = nativeTimeout; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
