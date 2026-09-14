import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Mp3Engine } from "../../app/lib/audio/mp3Engine";
import { MusicSessionCache } from "../../app/lib/audio/musicSessionCache";
import { clearMusicDiagnostics, exportMusicDiagnostics, recordMusicDiagnostic } from "../../app/lib/audio/musicDiagnostics";

class DiagnosticAudio extends EventTarget {
  src = ""; preload = ""; paused = true; ended = false; seeking = false; muted = false;
  currentTime = 0; duration = 1800; readyState = 3; networkState = 1; error = null; playCalls = 0;
  buffered = { length: 1, start: () => 0, end: () => 5 };
  load() { this.currentTime = 0; this.paused = true; this.dispatchEvent(new Event("loadstart")); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  removeAttribute() { this.src = ""; }
  async play() { this.playCalls++; this.paused = false; this.dispatchEvent(new Event("playing")); }
}
const browser = Object.assign(new EventTarget(), { location: { hostname: "production.invalid" } });
Object.assign(globalThis, { window: browser, Audio: DiagnosticAudio, HTMLMediaElement: { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3, NETWORK_LOADING: 2 } });
type State = Record<string, unknown>;
type Trace = { schemaVersion: number; entryCount: number; sources: Record<string, { descriptor: State; baseline: State }>; entries: {event:string;source:string;delta?:State;snapshot?:State;repeats?:number;spanMs?:number}[] };
const trace = () => JSON.parse(exportMusicDiagnostics()) as Trace;
function reconstruct(result: Trace) {
  const states = new Map(Object.entries(result.sources).map(([id, source]) => [id, source.baseline]));
  return result.entries.map(entry => {
    const state = entry.snapshot ?? { ...states.get(entry.source), ...entry.delta };
    states.set(entry.source, state);
    return { event: entry.event, details: { ...result.sources[entry.source].descriptor, ...state } };
  });
}
async function main() {
  recordMusicDiagnostic("disabled", {}); assert.equal(trace().entryCount, 0);
  browser.location.hostname = "test.soundspa.bodhemusic.com";
  for (let i = 0; i < 700; i++) recordMusicDiagnostic("bounded", { i });
  assert.equal(trace().entryCount, 600); assert.equal(reconstruct(trace())[0].details.i, 100);
  assert.equal(trace().sources.ui.baseline.i, 99);
  clearMusicDiagnostics();
  recordMusicDiagnostic("ui-play-pause", { channelId: "first", status: "loading" });
  recordMusicDiagnostic("ui-play-pause", { channelId: "second", status: "paused" });
  assert.equal(reconstruct(trace()).at(-1)!.details.channelId, "second");
  clearMusicDiagnostics();
  for (let i = 0; i < 750; i++) recordMusicDiagnostic(i % 29 === 0 ? "owner-copy-snapshot" : "sample", { engineId: i % 2, audioId: 1, generation: 0, sourceVersion: 1, currentTime: i, readyState: 4 });
  const replayAfterRoll = reconstruct(trace());
  assert.equal(replayAfterRoll[0].details.currentTime, 150); assert.equal(replayAfterRoll.at(-1)!.details.currentTime, 749);
  assert.equal(Object.keys(trace().sources).length, 2);
  clearMusicDiagnostics();
  const realDateNow = Date.now, baseTime = Date.now();
  try {
    for (let i = 0; i < 50; i++) {
      Date.now = () => baseTime + i * 2000;
      recordMusicDiagnostic("sample", { engineId: 1, audioId: 1, generation: 0, sourceVersion: 1, currentTime: 19.085595, bufferedRanges: [], readyState: 4 });
    }
  } finally { Date.now = realDateNow; }
  assert.equal(trace().entryCount, 1); assert.equal(trace().entries[0].repeats, 50); assert.equal(reconstruct(trace())[0].details.currentTime, 19.086);
  assert.equal(trace().entries[0].spanMs, 98000);
  clearMusicDiagnostics();
  const engine = new Mp3Engine([{ id: "track", url: "/music/test.mp3" }], new MusicSessionCache());
  const state = engine as unknown as { audio: DiagnosticAudio; evaluateBufferState: () => void };
  try {
    await engine.play(); for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(state.audio.playCalls, 1);
    state.audio.dispatchEvent(new Event("loadedmetadata"));
    state.audio.dispatchEvent(new Event("canplay"));
    state.audio.currentTime = 0.5; state.evaluateBufferState(); engine.captureDiagnostics();
    const result = trace();
    for (const event of ["engine-created", "source-assigned", "media-loadstart", "media-loadedmetadata", "media-canplay", "play-attempt", "play-resolved", "sample", "owner-copy-snapshot"]) assert(result.entries.some(entry => entry.event === event), event);
    assert.equal(result.schemaVersion, 2);
    const snapshot = reconstruct(result).at(-1)!.details;
    assert.equal(snapshot.sourceHasProgressed, true); assert.equal(snapshot.currentTime, 0.5);
    assert.equal(snapshot.phase, "audible-network"); assert.equal(snapshot.status, "playing");
    engine.pause(); assert.equal(engine.getSnapshot().status, "paused");
    const oldAudio = state.audio; engine.dispose(); const count = trace().entryCount;
    oldAudio.dispatchEvent(new Event("progress")); assert.equal(trace().entryCount, count);
    assert.equal(state.audio, null);
    console.info("PASS: staging-only gate; v2 delta replay; rolling baseline; identical sample aggregation; media/play/sampler identity; unchanged startup/progression/Pause; dispose cleanup.");
  } finally { engine.dispose(); clearMusicDiagnostics(); }
  for (const filename of process.argv.slice(2)) {
    const original = readFileSync(filename, "utf8");
    const legacy = JSON.parse(original.slice(original.indexOf("{"))) as { entries: { timestamp: string; event: string; details: State }[] };
    const base = Date.now(), firstTime = Date.parse(legacy.entries[0].timestamp);
    try {
      legacy.entries.forEach(entry => {
        Date.now = () => base + Date.parse(entry.timestamp) - firstTime;
        recordMusicDiagnostic(entry.event, entry.details);
      });
    } finally { Date.now = realDateNow; }
    const compact = exportMusicDiagnostics(); const ratio = Buffer.byteLength(original) / Buffer.byteLength(compact);
    assert(ratio >= 5, `size reduction ${ratio.toFixed(2)}x`);
    const replay = reconstruct(trace());
    assert.equal(replay.at(-1)!.details.playRequestId, legacy.entries.at(-1)!.details.playRequestId);
    assert.equal(replay.at(-1)!.details.sourceVersion, legacy.entries.at(-1)!.details.sourceVersion);
    console.info(`PASS: ${filename}: ${Buffer.byteLength(original)} → ${Buffer.byteLength(compact)} bytes (${ratio.toFixed(2)}x smaller)`);
    clearMusicDiagnostics();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
