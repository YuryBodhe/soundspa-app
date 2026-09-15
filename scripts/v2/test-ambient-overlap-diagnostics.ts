import assert from "node:assert/strict";
import {
  ambientOverlapDiagnosticsEnabled,
  clearAmbientOverlapDiagnostics,
  exportAmbientOverlapDiagnostics,
  recordAmbientOverlapDiagnostic,
} from "../../app/lib/audio/ambientOverlapDiagnostics";

const previousFlag = process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS;
const browser = { location: { hostname: "production.invalid" }, navigator: {}, userAgent: "test" };
Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: browser, configurable: true });

try {
  delete process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS;
  assert.equal(ambientOverlapDiagnosticsEnabled(), false);
  recordAmbientOverlapDiagnostic("disabled", new Proxy({}, { ownKeys() { throw new Error("disabled diagnostics inspected details"); } }));
  assert.equal(JSON.parse(exportAmbientOverlapDiagnostics()).entryCount, 0);

  process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS = "1";
  browser.location.hostname = "soundspa.bodhemusic.com";
  assert.equal(ambientOverlapDiagnosticsEnabled(), false, "production remains unavailable with the flag set");
  browser.location.hostname = "test.soundspa.bodhemusic.com";
  assert.equal(ambientOverlapDiagnosticsEnabled(), true);
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) { browser.location.hostname = host; assert.equal(ambientOverlapDiagnosticsEnabled(), true); }

  browser.location.hostname = "test.soundspa.bodhemusic.com";
  clearAmbientOverlapDiagnostics();
  for (let index = 0; index < 450; index += 1) recordAmbientOverlapDiagnostic("event", { index });
  let trace = JSON.parse(exportAmbientOverlapDiagnostics());
  assert.equal(trace.entryCount, 400, "trace is bounded");
  assert.equal(trace.entries[0].details.index, 50);

  clearAmbientOverlapDiagnostics();
  recordAmbientOverlapDiagnostic("overlap-proven", { transitionId: 1, currentTime: 8, candidateTime: 1 });
  trace = JSON.parse(exportAmbientOverlapDiagnostics());
  assert.equal(trace.entries[0].event, "overlap-proven");
  assert.match(trace.note, /A and B currentTime progression/);
  console.info("PASS: ambient overlap diagnostics are opt-in, staging/local-only, production-inert, bounded and export overlap proof.");
} finally {
  clearAmbientOverlapDiagnostics();
  if (previousFlag === undefined) delete process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS;
  else process.env.NEXT_PUBLIC_V2_AMBIENT_OVERLAP_DIAGNOSTICS = previousFlag;
}
