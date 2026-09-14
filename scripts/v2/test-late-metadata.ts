import assert from "node:assert/strict";
import { Mp3Engine } from "../../app/lib/audio/mp3Engine";
import { MusicSessionCache } from "../../app/lib/audio/musicSessionCache";
import { MusicResumeStore } from "../../app/lib/audio/musicResumeStore";

const nativeTimeout = globalThis.setTimeout;
const timers = new Map<ReturnType<typeof setTimeout>, { callback: () => void; delay: number }>();
globalThis.setTimeout = ((callback: () => void, delay = 0) => {
  const timer = nativeTimeout(callback, delay);
  timers.set(timer, { callback, delay });
  return timer;
}) as typeof setTimeout;
class TestAudio extends EventTarget {
  src = ""; preload = ""; muted = false; paused = true; seeking = false;
  currentTime = 0; duration = 1800; readyState = 0; networkState = 2;
  error = null; ended = false; playCalls = 0; ahead = 0;
  buffered = { length: 1, start: () => this.currentTime, end: () => this.currentTime + this.ahead };
  load() { this.currentTime = 0; this.paused = true; }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ""; }
  async play() { this.playCalls++; this.paused = false; }
  metadata() { this.readyState = 3; this.dispatchEvent(new Event("loadedmetadata")); }
}
Object.assign(globalThis, { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: "visible" }), Audio: TestAudio, HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3, NETWORK_LOADING: 2 } });
type Internal = { audio: TestAudio; sourceVersion: number; networkRetryTimer: ReturnType<typeof setTimeout> | null; networkRecoveryTarget: unknown; bufferSampleTimer: unknown; pendingSeekSourceVersion: number | null };
const engines: Mp3Engine[] = [];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function create(position = 120) {
  const store = new MusicResumeStore(() => null); store.write("channel", "track", position);
  const engine = new Mp3Engine([{ id: "track", url: "/music/test.mp3" }], new MusicSessionCache(), { channelId: "channel", store });
  engines.push(engine); const previous = new Set(timers.keys()); const pending = engine.play(); await flush();
  const timeout = [...timers].find(([id, value]) => !previous.has(id) && value.delay === 15000); assert(timeout);
  const state = engine as unknown as Internal;
  const expire = () => { clearTimeout(timeout[0]); timeout[1].callback(); };
  return { engine, state, pending, expire };
}
async function main() {
  try {
    const normal = await create(); normal.state.audio.ahead = 8; normal.state.audio.metadata(); await normal.pending; await flush();
    assert.equal(normal.state.audio.currentTime, 120); assert.equal(normal.state.audio.playCalls, 1); assert.equal(normal.state.networkRetryTimer, null);
    const late = await create(385); const original = late.state.audio; const version = late.state.sourceVersion;
    late.expire(); assert(late.state.networkRetryTimer); assert.equal(late.state.pendingSeekSourceVersion, version);
    late.state.audio.metadata(); await late.pending; await flush();
    assert.equal(late.state.audio, original); assert.equal(late.state.sourceVersion, version); assert.equal(original.currentTime, 385);
    assert.equal(late.state.networkRetryTimer, null); assert(late.state.networkRecoveryTarget); assert.equal(original.playCalls, 0);
    original.ahead = 8; original.dispatchEvent(new Event("progress")); await flush(); assert.equal(original.playCalls, 1);
    const replaced = await create(); const old = replaced.state.audio; replaced.expire();
    const retry = timers.get(replaced.state.networkRetryTimer!); assert(retry); clearTimeout(replaced.state.networkRetryTimer!); retry.callback(); await flush();
    assert.notEqual(replaced.state.audio, old); old.metadata(); await replaced.pending; await flush(); assert.equal(old.playCalls, 0); assert.equal(replaced.state.audio.currentTime, 0);
    const disposed = await create(); disposed.expire(); const stale = disposed.state.audio; disposed.engine.dispose(); stale.metadata(); await disposed.pending; assert.equal(stale.playCalls, 0);
    const stopped = await create(); stopped.expire(); stopped.engine.pause(); stopped.state.audio.ahead = 8; stopped.state.audio.metadata(); await stopped.pending; await flush();
    assert.equal(stopped.state.audio.playCalls, 0); assert.equal(stopped.engine.getSnapshot().status, "paused"); assert.equal(stopped.state.networkRetryTimer, null);
    console.info("PASS: metadata before timeout; late same-source nonzero seek and deferred readiness; obsolete retry cancelled after reentry; replaced/disposed source ignored; Stop wins.");
  } finally { engines.forEach(engine => engine.dispose()); for (const timer of timers.keys()) clearTimeout(timer); globalThis.setTimeout = nativeTimeout; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
