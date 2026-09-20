import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function main() {
const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
const credential = (await readFile(process.env.V2_TEST_DEVICE_CREDENTIAL_FILE ?? "/run/soundspa-v2/device-credential", "utf8")).trim();
const noCookie = await fetch(`${origin}/api/v2/catalog`); assert.equal(noCookie.status, 401);
const invalid = await fetch(`${origin}/api/v2/catalog`, { headers: { cookie: "soundspa_v2_device=invalid" } }); assert.equal(invalid.status, 401);
const response = await fetch(`${origin}/api/v2/catalog`, { headers: { cookie: `soundspa_v2_device=${credential}` } }); assert.equal(response.status, 200);
const body = await response.json() as { channels: Array<Record<string, unknown>> }; assert(Array.isArray(body.channels));
const spa = body.channels.find((c) => c.slug === "spaquatoria")!; assert(spa); assert.equal(spa.playable, true); assert((spa.accessSources as string[]).includes("base"));
const locked = body.channels.find((c) => c.playable === false); assert(locked); assert.deepEqual(locked.tracks, []);
const serialized = JSON.stringify(body); assert(!serialized.includes("storageKey")); assert(!serialized.includes("credentialHash")); assert(body.channels.some((c) => c.kind === "music")); assert(body.channels.some((c) => c.kind === "ambient"));
console.info("V2 customer catalog verification PASS: 401/invalid, authenticated device-derived catalog, Base, locked privacy, safe URLs, music/ambient.");

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
