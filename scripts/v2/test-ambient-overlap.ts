import assert from "node:assert/strict";
import { AmbientEngine, type AmbientTrack } from "../../app/lib/audio/ambientEngine";

type EventHandler = (event: Event) => void;

class FakeAudio {
  static instances: FakeAudio[] = [];
  static rejectNextPlay = false;
  readonly listeners = new Map<string, Set<EventHandler>>();
  currentTime = 0;
  duration = 10;
  readyState = 1;
  paused = true;
  loop = false;
  preload = "";
  volume = 1;
  src: string;
  playCount = 0;
  destroyed = false;

  constructor(src: string) { this.src = src; FakeAudio.instances.push(this); }
  addEventListener(name: string, handler: EventHandler) { const set = this.listeners.get(name) ?? new Set(); set.add(handler); this.listeners.set(name, set); }
  removeEventListener(name: string, handler: EventHandler) { this.listeners.get(name)?.delete(handler); }
  dispatch(name: string) { for (const handler of this.listeners.get(name) ?? []) handler(new Event(name)); }
  async play() { this.playCount += 1; if (FakeAudio.rejectNextPlay) { FakeAudio.rejectNextPlay = false; throw new DOMException("blocked", "NotAllowedError"); } this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() { if (!this.src) this.destroyed = true; }
}

class FakeNode { disconnected = false; connect() { return this; } disconnect() { this.disconnected = true; } }
class FakeGain extends FakeNode { gain = { value: 1 }; }
class FakeAudioContext {
  static sourceCalls = 0;
  static throwAtSourceCall = 0;
  state: AudioContextState = "running";
  destination = new FakeNode();
  createGain() { return new FakeGain(); }
  createMediaElementSource() {
    FakeAudioContext.sourceCalls += 1;
    if (FakeAudioContext.sourceCalls === FakeAudioContext.throwAtSourceCall) throw new Error("graph failure");
    return new FakeNode();
  }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}

const tracks: AmbientTrack[] = [
  { id: "a", url: "/noise/a.mp3" },
  { id: "b", url: "/noise/b.mp3" },
  { id: "c", url: "/noise/c.mp3" },
];
let objectUrlSequence = 0;

Object.defineProperty(globalThis, "window", { value: { AudioContext: FakeAudioContext, location: { hostname: "test.soundspa.bodhemusic.com" } }, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "ambient-overlap-test" }, configurable: true });
Object.defineProperty(globalThis, "Audio", { value: FakeAudio, configurable: true });
Object.defineProperty(globalThis, "HTMLMediaElement", { value: { HAVE_METADATA: 1 }, configurable: true });
Object.defineProperty(URL, "createObjectURL", { value: () => `blob:test-${++objectUrlSequence}`, configurable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, configurable: true });
Object.defineProperty(globalThis, "fetch", { value: async () => ({ ok: true, blob: async () => new Blob(["ambient"]) }), configurable: true });

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const internals = (engine: AmbientEngine) => engine as unknown as {
  audio: FakeAudio | null;
  candidate: { audio: FakeAudio; track: AmbientTrack; progressed: boolean; transitionTimer: ReturnType<typeof setTimeout> | null } | null;
  cache: Map<string, { objectUrl: string }>;
};

async function progressCandidate(engine: AmbientEngine) {
  const state = await prepareCandidate(engine);
  const current = state.audio;
  const candidate = state.candidate;
  assert(current && candidate);
  current.currentTime = 7;
  current.dispatch("timeupdate");
  await flush();
  current.currentTime = 7.1;
  candidate.audio.currentTime = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(candidate.progressed, true);
  assert.notEqual(candidate.transitionTimer, null);
  current.dispatch("ended");
  await flush();
  assert.equal(candidate.transitionTimer, null, "normal ended clears transition watchdog");
}

async function prepareCandidate(engine: AmbientEngine, currentTime = 4) {
  const state = internals(engine);
  assert(state.audio);
  assert.equal(state.candidate, null, "prepared Blob does not create an early second Audio");
  state.audio.currentTime = currentTime;
  state.audio.dispatch("timeupdate");
  await flush();
  assert(state.candidate);
  return state;
}

async function run() {
  FakeAudio.instances = []; objectUrlSequence = 0;
  const playlistEngine = new AmbientEngine(true);
  await playlistEngine.togglePlaylist("ambient-channel", tracks);
  await flush();
  await progressCandidate(playlistEngine);
  assert.equal(playlistEngine.getSnapshot().activeTrackId, "b");
  await progressCandidate(playlistEngine);
  assert.equal(playlistEngine.getSnapshot().activeTrackId, "c");
  await progressCandidate(playlistEngine);
  assert.equal(playlistEngine.getSnapshot().activeTrackId, "a", "A → B → C → A");
  assert(FakeAudio.instances.filter((audio) => !audio.destroyed).length <= 2, "at most two live Audio elements");
  playlistEngine.dispose();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 0, "dispose releases every deck");

  FakeAudio.instances = []; objectUrlSequence = 0;
  const selfEngine = new AmbientEngine(true);
  await selfEngine.togglePlaylist("single", [tracks[0]]); await flush();
  const self = await prepareCandidate(selfEngine);
  assert.equal(self.candidate?.track.id, "a");
  assert.equal(self.candidate?.audio.src, self.cache.get("a")?.objectUrl, "self-overlap reuses cached object URL");
  assert.equal(objectUrlSequence, 1, "self-overlap creates no duplicate Blob URL");
  selfEngine.stop();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 0, "stop during preparation releases both decks");

  FakeAudio.instances = [];
  const rejectedEngine = new AmbientEngine(true);
  await rejectedEngine.togglePlaylist("reject", tracks.slice(0, 2)); await flush();
  const rejected = await prepareCandidate(rejectedEngine);
  FakeAudio.rejectNextPlay = true;
  assert(rejected.audio && rejected.candidate);
  rejected.audio.currentTime = 7; rejected.audio.dispatch("timeupdate"); await flush();
  assert.equal(rejected.candidate, null, "candidate rejection preserves current and disposes candidate");
  assert.equal(rejected.audio.destroyed, false);
  const rejectedCount = FakeAudio.instances.length;
  rejected.audio.dispatch("timeupdate"); await flush();
  assert.equal(FakeAudio.instances.length, rejectedCount, "candidate rejection is not retried on every timeupdate");
  rejectedEngine.dispose();

  FakeAudio.instances = [];
  const frozenEngine = new AmbientEngine(true);
  await frozenEngine.togglePlaylist("frozen", tracks.slice(0, 2)); await flush();
  const frozen = await prepareCandidate(frozenEngine);
  assert(frozen.audio && frozen.candidate);
  frozen.audio.currentTime = 7; frozen.audio.dispatch("timeupdate"); await flush();
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  assert.equal(frozen.candidate, null, "non-progressing candidate is discarded");
  assert.equal(frozen.audio.destroyed, false, "non-progressing candidate never damages current deck");
  frozenEngine.dispose();

  FakeAudio.instances = [];
  const watchdogEngine = new AmbientEngine(true);
  await watchdogEngine.togglePlaylist("watchdog", tracks.slice(0, 2)); await flush();
  const watchdog = await prepareCandidate(watchdogEngine, 9.9);
  assert(watchdog.audio && watchdog.candidate);
  watchdog.candidate.audio.currentTime = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  const oldCurrent = watchdog.audio;
  await new Promise((resolve) => setTimeout(resolve, 1_650));
  assert.equal(oldCurrent.destroyed, true, "watchdog disposes A when ended is missing");
  assert.equal(internals(watchdogEngine).audio?.src.startsWith("blob:test-"), true);
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 1, "watchdog settles to one current Audio");
  watchdogEngine.dispose();

  FakeAudio.instances = [];
  const graphEngine = new AmbientEngine(true);
  FakeAudioContext.sourceCalls = 0;
  FakeAudioContext.throwAtSourceCall = 2;
  await graphEngine.togglePlaylist("graph", tracks.slice(0, 2)); await flush();
  const graph = internals(graphEngine);
  assert(graph.audio);
  graph.audio.currentTime = 4; graph.audio.dispatch("timeupdate"); await flush();
  assert.equal(graph.candidate, null, "failed candidate graph is never installed");
  assert.equal(FakeAudio.instances.at(-1)?.destroyed, true, "partially constructed candidate Audio is cleaned");
  assert.equal(graph.audio?.destroyed, false, "candidate graph failure preserves A");
  const graphCount = FakeAudio.instances.length;
  graph.audio?.dispatch("timeupdate"); await flush();
  assert.equal(FakeAudio.instances.length, graphCount, "graph failure is attempted once for the current boundary");
  graphEngine.dispose();
  FakeAudioContext.throwAtSourceCall = 0;

  FakeAudio.instances = [];
  const overlapStopEngine = new AmbientEngine(true);
  await overlapStopEngine.togglePlaylist("stop-overlap", tracks.slice(0, 2)); await flush();
  const overlapStop = await prepareCandidate(overlapStopEngine);
  assert(overlapStop.audio && overlapStop.candidate);
  const stoppedCandidate = overlapStop.candidate;
  overlapStop.audio.currentTime = 7; overlapStop.audio.dispatch("timeupdate"); await flush();
  stoppedCandidate.audio.currentTime = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.notEqual(stoppedCandidate.transitionTimer, null);
  overlapStopEngine.stop();
  assert.equal(stoppedCandidate.transitionTimer, null, "stop clears transition watchdog");
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 0, "stop during overlap releases both decks");

  FakeAudio.instances = [];
  const staleEngine = new AmbientEngine(true);
  await staleEngine.togglePlaylist("old", tracks.slice(0, 2)); await flush();
  const staleState = await prepareCandidate(staleEngine);
  assert(staleState.audio && staleState.candidate);
  const staleCandidate = staleState.candidate;
  staleState.audio.currentTime = 7; staleState.audio.dispatch("timeupdate"); await flush();
  staleCandidate.audio.currentTime = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  await staleEngine.togglePlaylist("new", tracks.slice(1)); await flush();
  staleCandidate.audio.dispatch("loadedmetadata");
  assert.equal(staleCandidate.transitionTimer, null, "channel switch clears transition watchdog");
  assert.equal(staleCandidate.audio.destroyed, true, "channel switch invalidates stale candidate callbacks");
  staleEngine.dispose();

  FakeAudio.instances = [];
  const legacyEngine = new AmbientEngine(false);
  await legacyEngine.togglePlaylist("legacy", tracks); await flush();
  assert.equal(internals(legacyEngine).candidate, null, "feature flag off creates no overlap deck");
  assert.equal(internals(legacyEngine).audio?.src, tracks[0].url, "feature flag off preserves first-track network start");
  assert.equal(internals(legacyEngine).audio?.listeners.has("timeupdate"), false, "feature flag off installs no overlap sampler listener");
  internals(legacyEngine).audio?.dispatch("ended"); await flush();
  assert.equal(internals(legacyEngine).audio?.loop, true);
  assert.equal(internals(legacyEngine).audio?.listeners.has("ended"), false, "feature flag off Blob loop has baseline listeners");
  legacyEngine.dispose();

  console.info("PASS: ambient A/B/C playlist, self-overlap Blob reuse, candidate rejection/non-progression, bounded missing-ended watchdog, graph exception cleanup, stop during preparation/overlap, switch/dispose cleanup, resource bounds and exact feature-flag rollback path.");
}

void run();
