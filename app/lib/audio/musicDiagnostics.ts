// Temporary, local-only capture on the isolated staging hostname. No requests or storage.
const STAGING_HOST = "test.soundspa.bodhemusic.com";
const MAX_ENTRIES = 600;
type Entry = { timestamp: string; elapsedMs: number; event: string; details: Record<string, unknown> };
let nextEngineId = 0;
const startedAt = Date.now();
const entries: Entry[] = [];
export const musicDiagnosticsEnabled = () => typeof window !== "undefined" && window.location?.hostname === STAGING_HOST;
export const allocateMusicDiagnosticId = () => ++nextEngineId;
export function recordMusicDiagnostic(event: string, details: Record<string, unknown>) {
  if (!musicDiagnosticsEnabled()) return;
  entries.push({ timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt, event, details });
  if (entries.length > MAX_ENTRIES) entries.shift();
}
export function exportMusicDiagnostics() {
  return JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), userAgent: navigator.userAgent,
    entryCount: entries.length, maxEntries: MAX_ENTRIES,
    note: "Native media Range request headers are not exposed to page JavaScript; full fetch lifecycle is captured. No credentials or media bytes are recorded.", entries }, null, 2);
}
export function clearMusicDiagnostics() { entries.length = 0; }
