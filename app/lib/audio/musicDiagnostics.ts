// Temporary, local-only capture on the isolated staging hostname. No requests or storage.
const STAGING_HOST = "test.soundspa.bodhemusic.com";
const MAX_ENTRIES = 600;
type State = Record<string, unknown>;
type Entry = { t: number; event: string; source: string; delta?: State; snapshot?: State; data?: unknown; repeats?: number; spanMs?: number };
type Source = { descriptor: State; baseline: State };
const descriptorKeys = new Set(["engineId", "audioId", "channelId", "trackId", "trackUrl", "trackIndex", "generation", "sourceVersion", "sourceKind"]);
const fullSnapshot = /^(engine-created|source-assigned|audio-recreated|startup-buffer-ready|startup-plateau-fallback|empty-ranges-provisional-start|status-transition|owner-copy-snapshot|.*error|.*rejected|network-retry-fired|real-progression-restored)$/;
let nextEngineId = 0;
const startedAt = Date.now();
const entries: Entry[] = [];
const sources = new Map<string, Source>();
const current = new Map<string, State>();
const lastSamples = new Map<string, { entry: Entry; state: string }>();
export const musicDiagnosticsEnabled = () => typeof window !== "undefined" && window.location?.hostname === STAGING_HOST;
export const allocateMusicDiagnosticId = () => ++nextEngineId;
const normalize = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
};
export function recordMusicDiagnostic(event: string, details: State) {
  if (!musicDiagnosticsEnabled()) return;
  const normalized = normalize(details) as State;
  const source = details.engineId === undefined ? "ui" : `${details.engineId}:${details.audioId}:${details.generation}:${details.sourceVersion}`;
  const descriptor = source === "ui" ? {} : Object.fromEntries(Object.entries(normalized).filter(([key]) => descriptorKeys.has(key)));
  const state = Object.fromEntries(Object.entries(normalized).filter(([key]) => (source === "ui" || !descriptorKeys.has(key)) && key !== "eventDetails"));
  if (!sources.has(source)) sources.set(source, { descriptor, baseline: {} });
  const previous = current.get(source) ?? {};
  const delta = Object.fromEntries(Object.entries(state).filter(([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value)));
  const t = Date.now() - startedAt;
  const stateKey = JSON.stringify(state);
  const lastSample = lastSamples.get(source);
  if (event === "sample" && lastSample?.state === stateKey && Object.keys(delta).length === 0) {
    lastSample.entry.repeats = (lastSample.entry.repeats ?? 1) + 1;
    lastSample.entry.spanMs = t - lastSample.entry.t;
    return;
  }
  const entry: Entry = { t, event, source };
  if (fullSnapshot.test(event)) entry.snapshot = state;
  else if (Object.keys(delta).length) entry.delta = delta;
  if (normalized.eventDetails && Object.keys(normalized.eventDetails as State).length) entry.data = normalized.eventDetails;
  entries.push(entry);
  current.set(source, { ...previous, ...state });
  if (event === "sample") lastSamples.set(source, { entry, state: stateKey });
  else if (Object.keys(delta).length) lastSamples.delete(source);
  if (entries.length > MAX_ENTRIES) {
    const removed = entries.shift()!;
    const retained = sources.get(removed.source)!;
    retained.baseline = removed.snapshot ? { ...removed.snapshot } : { ...retained.baseline, ...removed.delta };
    if (lastSamples.get(removed.source)?.entry === removed) lastSamples.delete(removed.source);
    if (!entries.some(item => item.source === removed.source)) {
      sources.delete(removed.source); current.delete(removed.source); lastSamples.delete(removed.source);
    }
  }
}
export function exportMusicDiagnostics() {
  return JSON.stringify({ schemaVersion: 2, startedAt: new Date(startedAt).toISOString(), capturedAt: new Date().toISOString(),
    build: { engineRevision: "safari-empty-ranges-v1", commit: process.env.NEXT_PUBLIC_BUILD_SHA ?? null }, userAgent: navigator.userAgent,
    entryCount: entries.length, maxEntries: MAX_ENTRIES,
    note: "Replay each source baseline, then snapshot/merge delta in entry order. t/spanMs are milliseconds from startedAt; values rounded to 0.001. Range headers unavailable to JS. No credentials/media bytes.",
    sources: Object.fromEntries(sources), entries });
}
export function clearMusicDiagnostics() { entries.length = 0; sources.clear(); current.clear(); lastSamples.clear(); }
