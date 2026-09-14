import assert from "node:assert/strict";
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
const trace = () => JSON.parse(exportMusicDiagnostics()) as { entryCount: number; entries: {event:string;details:Record<string,unknown>}[] };
async function main() {
  recordMusicDiagnostic("disabled", {}); assert.equal(trace().entryCount, 0);
  browser.location.hostname = "test.soundspa.bodhemusic.com";
  for (let i = 0; i < 700; i++) recordMusicDiagnostic("bounded", { i });
  assert.equal(trace().entryCount, 600); assert.equal(trace().entries[0].details.i, 100);
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
    const snapshot = result.entries.at(-1)!.details;
    assert.equal(snapshot.sourceHasProgressed, true); assert.equal(snapshot.currentTime, 0.5);
    assert.equal(snapshot.phase, "audible-network"); assert.equal(snapshot.status, "playing");
    engine.pause(); assert.equal(engine.getSnapshot().status, "paused");
    const oldAudio = state.audio; engine.dispose(); const count = trace().entryCount;
    oldAudio.dispatchEvent(new Event("progress")); assert.equal(trace().entryCount, count);
    assert.equal(state.audio, null);
    console.info("PASS: staging-only gate; bounded rolling trace; media/play/sampler snapshots; unchanged startup/progression/Pause; dispose cleanup; JSON export.");
  } finally { engine.dispose(); clearMusicDiagnostics(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
