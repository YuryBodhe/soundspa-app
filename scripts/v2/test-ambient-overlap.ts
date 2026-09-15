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
  state: AudioContextState = "running";
  destination = new FakeNode();
  createGain() { return new FakeGain(); }
  createMediaElementSource() { return new FakeNode(); }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}

const tracks: AmbientTrack[] = [
  { id: "a", url: "/noise/a.mp3" },
  { id: "b", url: "/noise/b.mp3" },
  { id: "c", url: "/noise/c.mp3" },
];
let objectUrlSequence = 0;

Object.defineProperty(globalThis, "window", { value: { AudioContext: FakeAudioContext }, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
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
  candidate: { audio: FakeAudio; track: AmbientTrack; progressed: boolean } | null;
  cache: Map<string, { objectUrl: string }>;
};

async function progressCandidate(engine: AmbientEngine) {
  const state = internals(engine);
  assert(state.audio && state.candidate);
  state.audio.currentTime = 7;
  state.audio.dispatch("timeupdate");
  await flush();
  state.candidate.audio.currentTime = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(state.candidate?.progressed, true);
  state.audio.dispatch("ended");
  await flush();
}

async function run() {
  FakeAudio.instances = []; objectUrlSequence = 0;
  const playlistEngine = new AmbientEngine(true);
  await playlistEngine.togglePlaylist("ambient-channel", tracks);
  await flush();
  assert.equal(internals(playlistEngine).candidate?.track.id, "b");
  await progressCandidate(playlistEngine);
  assert.equal(playlistEngine.getSnapshot().activeTrackId, "b");
  await flush();
  assert.equal(internals(playlistEngine).candidate?.track.id, "c");
  await progressCandidate(playlistEngine);
  assert.equal(playlistEngine.getSnapshot().activeTrackId, "c");
  await flush();
  assert.equal(internals(playlistEngine).candidate?.track.id, "a");
  await progressCandidate(playlistEngine);
  assert.equal(playlistEngine.getSnapshot().activeTrackId, "a", "A → B → C → A");
  assert(FakeAudio.instances.filter((audio) => !audio.destroyed).length <= 2, "at most two live Audio elements");
  playlistEngine.dispose();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 0, "dispose releases every deck");

  FakeAudio.instances = []; objectUrlSequence = 0;
  const selfEngine = new AmbientEngine(true);
  await selfEngine.togglePlaylist("single", [tracks[0]]); await flush();
  const self = internals(selfEngine);
  assert.equal(self.candidate?.track.id, "a");
  assert.equal(self.candidate?.audio.src, self.cache.get("a")?.objectUrl, "self-overlap reuses cached object URL");
  assert.equal(objectUrlSequence, 1, "self-overlap creates no duplicate Blob URL");
  selfEngine.stop();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 0, "stop during preparation releases both decks");

  FakeAudio.instances = [];
  const rejectedEngine = new AmbientEngine(true);
  await rejectedEngine.togglePlaylist("reject", tracks.slice(0, 2)); await flush();
  const rejected = internals(rejectedEngine);
  FakeAudio.rejectNextPlay = true;
  assert(rejected.audio && rejected.candidate);
  rejected.audio.currentTime = 7; rejected.audio.dispatch("timeupdate"); await flush();
  assert.equal(rejected.candidate, null, "candidate rejection preserves current and disposes candidate");
  assert.equal(rejected.audio.destroyed, false);
  rejectedEngine.dispose();

  FakeAudio.instances = [];
  const frozenEngine = new AmbientEngine(true);
  await frozenEngine.togglePlaylist("frozen", tracks.slice(0, 2)); await flush();
  const frozen = internals(frozenEngine);
  assert(frozen.audio && frozen.candidate);
  frozen.audio.currentTime = 7; frozen.audio.dispatch("timeupdate"); await flush();
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  assert.equal(frozen.candidate, null, "non-progressing candidate is discarded");
  assert.equal(frozen.audio.destroyed, false, "non-progressing candidate never damages current deck");
  frozenEngine.dispose();

  FakeAudio.instances = [];
  const overlapStopEngine = new AmbientEngine(true);
  await overlapStopEngine.togglePlaylist("stop-overlap", tracks.slice(0, 2)); await flush();
  const overlapStop = internals(overlapStopEngine);
  assert(overlapStop.audio && overlapStop.candidate);
  overlapStop.audio.currentTime = 7; overlapStop.audio.dispatch("timeupdate"); await flush();
  overlapStopEngine.stop();
  assert.equal(FakeAudio.instances.filter((audio) => !audio.destroyed).length, 0, "stop during overlap releases both decks");

  FakeAudio.instances = [];
  const staleEngine = new AmbientEngine(true);
  await staleEngine.togglePlaylist("old", tracks.slice(0, 2)); await flush();
  const staleCandidate = internals(staleEngine).candidate?.audio;
  await staleEngine.togglePlaylist("new", tracks.slice(1)); await flush();
  staleCandidate?.dispatch("loadedmetadata");
  assert.equal(staleCandidate?.destroyed, true, "channel switch invalidates stale candidate callbacks");
  staleEngine.dispose();

  FakeAudio.instances = [];
  const legacyEngine = new AmbientEngine(false);
  await legacyEngine.togglePlaylist("legacy", tracks); await flush();
  assert.equal(internals(legacyEngine).candidate, null, "feature flag off creates no overlap deck");
  assert.equal(internals(legacyEngine).audio?.src, tracks[0].url, "feature flag off preserves first-track network start");
  legacyEngine.dispose();

  console.info("PASS: ambient A/B/C playlist, self-overlap Blob reuse, candidate rejection/non-progression, stop during preparation/overlap, switch/dispose cleanup, resource bounds and feature-flag rollback.");
}

void run();
