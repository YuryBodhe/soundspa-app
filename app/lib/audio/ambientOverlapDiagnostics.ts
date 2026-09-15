// Temporary, opt-in staging/local diagnostics for real-device ambient overlap acceptance.
const STAGING_HOST = "test.soundspa.bodhemusic.com";
const MAX_ENTRIES = 400;

type Details = Record<string, unknown>;
type Entry = { t: number; event: string; details: Details; repeats?: number; spanMs?: number };

const startedAt = Date.now();
const entries: Entry[] = [];

export const ambientOverlapDiagnosticsEnabled = () => {
  if (process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS !== "1" || typeof window === "undefined") return false;
  const host = window.location?.hostname;
  return host === STAGING_HOST || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
};

const normalize = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
};

export function recordAmbientOverlapDiagnostic(event: string, details: Details) {
  if (!ambientOverlapDiagnosticsEnabled()) return;
  const normalized = normalize(details) as Details;
  const t = Date.now() - startedAt;
  const previous = entries.at(-1);
  if (event === "overlap-sample" && previous?.event === event && JSON.stringify(previous.details) === JSON.stringify(normalized)) {
    previous.repeats = (previous.repeats ?? 1) + 1;
    previous.spanMs = t - previous.t;
    return;
  }
  entries.push({ t, event, details: normalized });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function exportAmbientOverlapDiagnostics() {
  return JSON.stringify({
    schemaVersion: 1,
    startedAt: new Date(startedAt).toISOString(),
    capturedAt: new Date().toISOString(),
    build: { commit: process.env.NEXT_PUBLIC_BUILD_SHA ?? null },
    userAgent: navigator.userAgent,
    entryCount: entries.length,
    maxEntries: MAX_ENTRIES,
    note: "Times are milliseconds from startedAt. overlap-proven requires observed A and B currentTime progression before A ended; play resolution alone is not success.",
    entries,
  });
}

export function clearAmbientOverlapDiagnostics() { entries.length = 0; }
