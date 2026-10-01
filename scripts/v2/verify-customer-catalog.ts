import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authenticateDeviceCredential } from "../../db/v2/queries/devices";
import { getBaseChannelIds } from "../../db/v2/queries/base";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { filterVisibleChannels, getHiddenChannelIds } from "../../db/v2/queries/locationChannelVisibility";
import { v2Pool } from "../../db/v2/client";

async function main() {
  try {
    const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
    const credential = (await readFile(process.env.V2_TEST_DEVICE_CREDENTIAL_FILE ?? "/run/soundspa-v2/device-credential", "utf8")).trim();
    const noCookie = await fetch(`${origin}/api/v2/catalog`); assert.equal(noCookie.status, 401);
    const invalid = await fetch(`${origin}/api/v2/catalog`, { headers: { cookie: "soundspa_v2_device=invalid" } }); assert.equal(invalid.status, 401);
    const response = await fetch(`${origin}/api/v2/catalog`, { headers: { cookie: `soundspa_v2_device=${credential}` } }); assert.equal(response.status, 200);
    const body = await response.json() as { channels: Array<{ id: string; slug: string; playable: boolean; accessSources: string[]; tracks: unknown[]; kind: string }> };
    assert(Array.isArray(body.channels));
    const device = await authenticateDeviceCredential(credential); assert(device);
    const [effective, hidden, baseIds] = await Promise.all([resolveEffectiveChannelAccess(device.locationId, new Date()), getHiddenChannelIds(device.locationId), getBaseChannelIds()]);
    const visibleBase = filterVisibleChannels(effective, hidden).find((item) => item.playable && baseIds.includes(item.id));
    assert(visibleBase, "Current Location must have at least one visible playable Base channel for this acceptance check");
    const baseItem = body.channels.find((item) => item.id === visibleBase.id); assert(baseItem?.playable); assert(baseItem.accessSources.includes("base"));
    const locked = body.channels.find((c) => c.playable === false); assert(locked); assert.deepEqual(locked.tracks, []);
    for (const id of hidden) assert.equal(body.channels.some((item) => item.id === id), false, "hidden channels must be omitted from customer DTO");
    const serialized = JSON.stringify(body); assert(!serialized.includes("storageKey")); assert(!serialized.includes("credentialHash")); assert(body.channels.some((c) => c.kind === "music")); assert(body.channels.some((c) => c.kind === "ambient"));
    console.info("V2 customer catalog verification PASS: 401/invalid, authenticated device-derived catalog, current live Base membership, hidden omission, locked privacy, safe URLs, music/ambient.");
  } finally { await v2Pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
