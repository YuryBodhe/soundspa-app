import assert from "node:assert/strict";
import { AmbientEngine } from "../../app/lib/audio/ambientEngine";
import { clearAmbientOverlapDiagnostics, exportAmbientOverlapDiagnostics } from "../../app/lib/audio/ambientOverlapDiagnostics";

type Handler = (event: Event) => void;
class FakeAudio {
  static instances: FakeAudio[] = [];
  static rejectNextPlay = false;
  readonly listeners = new Map<string, Set<Handler>>();
  src: string; currentTime = 0; duration = 10; readyState = 1; paused = true; ended = false; error = null;
  preload = ""; loop = false; volume = 1; destroyed = false; playCalls = 0;
  constructor(src: string) { this.src = src; FakeAudio.instances.push(this); }
  addEventListener(name: string, fn: Handler) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); }
  removeEventListener(name: string, fn: Handler) { this.listeners.get(name)?.delete(fn); }
  dispatch(name: string) { for (const fn of this.listeners.get(name) ?? []) fn(new Event(name)); }
  async play() { this.playCalls++; if (FakeAudio.rejectNextPlay) { FakeAudio.rejectNextPlay = false; throw new DOMException("blocked", "NotAllowedError"); } this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() { if (!this.src) this.destroyed = true; this.currentTime = 0; this.paused = true; }
}
class FakeNode { disconnected = false; connect() { return this; } disconnect() { this.disconnected = true; } }
class FakeGain extends FakeNode { gain = { value: 1 }; }
class FakeContext { state: AudioContextState = "running"; destination = new FakeNode(); createGain() { return new FakeGain(); } createMediaElementSource() { return new FakeNode(); } async resume() { this.state = "running"; } async close() { this.state = "closed"; } }
Object.defineProperty(globalThis, "window", { value: { AudioContext: FakeContext, location: { hostname: "test.soundspa.bodhemusic.com" } }, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "persistent-deck-test" }, configurable: true });
Object.defineProperty(globalThis, "Audio", { value: FakeAudio, configurable: true });
Object.defineProperty(globalThis, "HTMLMediaElement", { value: { HAVE_METADATA: 1 }, configurable: true });
Object.defineProperty(URL, "createObjectURL", { value: () => "blob:persistent-test", configurable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, configurable: true });
Object.defineProperty(globalThis, "fetch", { value: async () => ({ ok: true, blob: async () => new Blob(["ambient"]) }), configurable: true });
process.env.NEXT_PUBLIC_V2_AMBIENT_PERSISTENT_DECKS = "1";
process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS = "1";

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const track = { id: "a", url: "/noise/a.mp3" };
const internals = (engine: AmbientEngine) => engine as unknown as { persistentDecks: { current: { audio: FakeAudio; id: string }; standby: { audio: FakeAudio; id: string; primeProgressed: boolean }; candidateStarted: boolean } | null };
const events = () => (JSON.parse(exportAmbientOverlapDiagnostics()) as { entries: { event: string; details: Record<string, unknown> }[] }).entries;

async function run() {
  clearAmbientOverlapDiagnostics(); FakeAudio.instances = [];
  const engine = new AmbientEngine(true);
  const promise = engine.togglePlaylist("one", [track]);
  assert.equal(FakeAudio.instances.length, 2, "both persistent decks created synchronously before toggle returns");
  assert.equal(FakeAudio.instances[0].playCalls, 1); assert.equal(FakeAudio.instances[1].playCalls, 1);
  await promise; await flush();
  let state = internals(engine).persistentDecks!;
  const first = state.current.audio, second = state.standby.audio;
  second.currentTime = 0.1; await wait(120);
  assert.equal(second.paused, true, "standby pauses after real priming progression");
  assert.equal(state.standby.primeProgressed, true);
  assert.equal(FakeAudio.instances.length, 2);
  for (const expected of ["B", "A", "B"]) {
    state = internals(engine).persistentDecks!;
    const current = state.current.audio, standby = state.standby.audio;
    const playCallsBeforeBoundary = standby.playCalls;
    current.currentTime = 4.9; current.dispatch("timeupdate");
    assert.equal(standby.playCalls, playCallsBeforeBoundary, "standby does not start before the five-second overlap boundary");
    current.currentTime = 5; current.dispatch("timeupdate");
    assert.equal(standby.playCalls, playCallsBeforeBoundary + 1, "standby starts at the five-second overlap boundary");
    assert.equal(standby.playCalls >= 2, true, "automatic standby play attempted");
    current.currentTime = 5.1; standby.currentTime = 0.1; current.dispatch("timeupdate");
    await wait(120); current.dispatch("timeupdate");
    current.ended = true; current.dispatch("ended"); await flush(); current.ended = false;
    state = internals(engine).persistentDecks!;
    assert.equal(state.current.id, expected);
    assert.equal(FakeAudio.instances.length, 2, "no third Audio across repeated transitions");
  }
  assert(events().some(entry => entry.event === "overlap-proven"), "simultaneous currentTime progression is recorded");
  engine.stop(); assert(FakeAudio.instances.every(audio => audio.destroyed));

  FakeAudio.instances = []; clearAmbientOverlapDiagnostics();
  const rejected = new AmbientEngine(true);
  FakeAudio.rejectNextPlay = true; await rejected.togglePlaylist("reject-prime", [track]); await flush();
  assert.equal(FakeAudio.instances.length, 2); assert(events().some(entry => entry.event === "persistent-prime-play-rejected"));
  rejected.stop();

  FakeAudio.instances = []; clearAmbientOverlapDiagnostics();
  const later = new AmbientEngine(true); await later.togglePlaylist("reject-later", [track]); await flush();
  state = internals(later).persistentDecks!; state.standby.audio.currentTime = 0.1; await wait(120);
  FakeAudio.rejectNextPlay = true; state.current.audio.currentTime = 7.1; state.current.audio.dispatch("timeupdate"); await flush();
  assert(events().some(entry => entry.event === "persistent-fallback" && entry.details.reason === "play-rejected"));
  assert.equal(state.current.audio.destroyed, false); later.dispose(); assert(FakeAudio.instances.every(audio => audio.destroyed));

  FakeAudio.instances = []; clearAmbientOverlapDiagnostics();
  const stopped = new AmbientEngine(true); await stopped.togglePlaylist("stop", [track]); await flush();
  state = internals(stopped).persistentDecks!; state.standby.audio.currentTime = 0.1; await wait(120);
  state.current.audio.currentTime = 7.1; state.current.audio.dispatch("timeupdate");
  const stale = state.standby.audio; stopped.stop(); stale.currentTime = 0.1; stale.dispatch("timeupdate"); stale.dispatch("ended"); await wait(120);
  assert(FakeAudio.instances.every(audio => audio.destroyed), "stop releases both decks and stale callbacks do nothing");

  FakeAudio.instances = []; clearAmbientOverlapDiagnostics();
  const switched = new AmbientEngine(true); await switched.togglePlaylist("first", [track]); await flush();
  state = internals(switched).persistentDecks!; state.standby.audio.currentTime = 0.1; await wait(120);
  state.current.audio.currentTime = 7.1; state.current.audio.dispatch("timeupdate");
  const oldDecks = [...FakeAudio.instances];
  await switched.togglePlaylist("second", [{ id: "other", url: "/noise/other.mp3" }]); await flush();
  assert(oldDecks.every(audio => audio.destroyed), "channel switch stops both old decks during overlap");
  oldDecks.forEach(audio => { audio.dispatch("timeupdate"); audio.dispatch("ended"); });
  assert.equal(FakeAudio.instances.filter(audio => !audio.destroyed).length, 2, "only new selection's two decks remain");
  switched.dispose(); assert(FakeAudio.instances.every(audio => audio.destroyed));

  FakeAudio.instances = []; clearAmbientOverlapDiagnostics();
  const disposed = new AmbientEngine(true); await disposed.togglePlaylist("dispose", [track]); await flush();
  state = internals(disposed).persistentDecks!; state.standby.audio.currentTime = 0.1; await wait(120);
  state.current.audio.currentTime = 7.1; state.current.audio.dispatch("timeupdate");
  disposed.dispose(); await wait(120);
  assert(FakeAudio.instances.every(audio => audio.destroyed), "dispose during overlap releases both decks");

  FakeAudio.instances = []; clearAmbientOverlapDiagnostics();
  const off = process.env.NEXT_PUBLIC_V2_AMBIENT_PERSISTENT_DECKS; process.env.NEXT_PUBLIC_V2_AMBIENT_PERSISTENT_DECKS = "0";
  const legacy = new AmbientEngine(true); await legacy.togglePlaylist("flag-off", [track]); await flush();
  assert.equal(FakeAudio.instances.length, 1, "persistent flag OFF preserves prior candidate transport"); legacy.dispose();
  process.env.NEXT_PUBLIC_V2_AMBIENT_PERSISTENT_DECKS = off;
  console.info("PASS: synchronous two-deck priming, repeated A/B/A promotion, max two Audio, priming/later play rejection fallback, stop/dispose/stale safety and feature-flag rollback.");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
