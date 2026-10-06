import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { baseChannels, channels, locationChannelGrants, locationChannelVisibility, locations } from "../../db/v2/schema";

const LOCATION_ID = "15452bf7-c196-41fc-a1a4-9a0ed9e1a044";
const DIVNITSA_ID = "418dbf0f-50c3-49fa-86ea-be414607a32a";

async function main() {
  let mutationStarted = false;
  let origin = ""; let basic = ""; let deviceCredential = "";
  try {
    const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
    assert.equal(target.rows[0]?.database, "soundspa_v2"); assert.equal(target.rows[0]?.user, "soundspa_v2");
    const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`); assert.equal(journal.rows[0]?.count, 11);
    const counts = await v2Db.execute(sql`SELECT (SELECT count(*)::int FROM channels) AS channels, (SELECT count(*)::int FROM channel_tracks) AS tracks, (SELECT count(*)::int FROM channel_tracks WHERE is_enabled) AS enabled`);
    assert.deepEqual(counts.rows[0], { channels: 11, tracks: 32, enabled: 31 });
    const [{ getHiddenChannelIds }] = await Promise.all([import("../../db/v2/queries/locationChannelVisibility")]);
    const [location] = await v2Db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, LOCATION_ID), isNull(locations.archivedAt)));
    const [channel] = await v2Db.select({ id: channels.id, slug: channels.slug }).from(channels).where(and(eq(channels.id, DIVNITSA_ID), eq(channels.isPublished, true), isNull(channels.archivedAt)));
    assert(location && channel); assert.equal(channel.slug, "divnitsa");

    const baseBefore = (await v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels).orderBy(baseChannels.channelId)).map((row) => row.channelId);
    const grantsBefore = (await v2Db.select().from(locationChannelGrants).where(and(eq(locationChannelGrants.locationId, LOCATION_ID), eq(locationChannelGrants.source, "admin")))).map((row) => ({ channelId: row.channelId, source: row.source, enabled: row.enabled, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null })).sort((a, b) => a.channelId.localeCompare(b.channelId));
    const hiddenBefore = await getHiddenChannelIds(LOCATION_ID);
    assert(!hiddenBefore.has(DIVNITSA_ID), "Yury Test Spa Divnitsa must be visible before the lifecycle test");
    const [grant] = await v2Db.select().from(locationChannelGrants).where(and(eq(locationChannelGrants.locationId, LOCATION_ID), eq(locationChannelGrants.channelId, DIVNITSA_ID), eq(locationChannelGrants.source, "admin")));
    assert(grant?.enabled, "Divnitsa Admin grant must be enabled before lifecycle test");

    origin = new URL(process.env.V2_VERIFY_ORIGIN ?? "https://test.soundspa.bodhemusic.com").origin;
    assert(origin.startsWith("https://"), "Verification origin must be HTTPS");
    const username = process.env.V2_ADMIN_USERNAME; const password = process.env.V2_ADMIN_PASSWORD;
    assert(username && password, "V2 Admin credentials must be configured in runtime environment");
    basic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    deviceCredential = (await readFile(process.env.V2_TEST_DEVICE_CREDENTIAL_FILE ?? "/run/soundspa-v2/device-credential", "utf8")).trim();
    assert(deviceCredential.length > 0);

    const post = async (operation: "hide-channel" | "show-channel", authorization?: string, requestOrigin = origin) => {
      const body = new FormData(); body.set("operation", operation); body.set("locationId", LOCATION_ID); body.set("channelId", DIVNITSA_ID);
      return fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { Origin: requestOrigin, Accept: "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body });
    };
    const catalog = async () => {
      const response = await fetch(`${origin}/api/v2/catalog`, { headers: { Cookie: `soundspa_v2_device=${deviceCredential}` } });
      assert.equal(response.status, 200); return (await response.json() as { channels: Array<{ id: string; playable: boolean; accessSources: string[] }> }).channels;
    };
    const initiallyVisible = (await catalog()).find((item) => item.id === DIVNITSA_ID);
    assert(initiallyVisible?.playable); assert(initiallyVisible.accessSources.includes("admin"));
    assert.equal((await post("hide-channel")).status, 401, "unauthenticated mutation rejected");
    assert.equal((await post("hide-channel", basic, "https://attacker.invalid")).status, 403, "cross-origin mutation rejected");
    assert.equal((await post("hide-channel", undefined, origin)).status, 401, "device identity alone cannot authorize Admin mutation");

    mutationStarted = true;
    const hideResponse = await post("hide-channel", basic); assert.equal(hideResponse.status, 200); assert.deepEqual(await hideResponse.json(), { ok: true });
    assert((await getHiddenChannelIds(LOCATION_ID)).has(DIVNITSA_ID));
    assert.equal((await catalog()).some((item) => item.id === DIVNITSA_ID), false, "hidden channel is absent from customer catalog");
    const hiddenGrant = await v2Db.select().from(locationChannelGrants).where(and(eq(locationChannelGrants.locationId, LOCATION_ID), eq(locationChannelGrants.channelId, DIVNITSA_ID), eq(locationChannelGrants.source, "admin")));
    assert.deepEqual(hiddenGrant, [grant], "hiding must preserve the original Admin grant row");

    const showResponse = await post("show-channel", basic); assert.equal(showResponse.status, 200); assert.deepEqual(await showResponse.json(), { ok: true });
    assert(!(await getHiddenChannelIds(LOCATION_ID)).has(DIVNITSA_ID));
    const restored = (await catalog()).find((item) => item.id === DIVNITSA_ID);
    assert(restored?.playable); assert(restored.accessSources.includes("admin"));
    assert.deepEqual((await v2Db.select().from(locationChannelGrants).where(and(eq(locationChannelGrants.locationId, LOCATION_ID), eq(locationChannelGrants.channelId, DIVNITSA_ID), eq(locationChannelGrants.source, "admin")))), [grant]);
    assert.deepEqual((await v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels).orderBy(baseChannels.channelId)).map((row) => row.channelId), baseBefore);
    const grantsAfter = (await v2Db.select().from(locationChannelGrants).where(and(eq(locationChannelGrants.locationId, LOCATION_ID), eq(locationChannelGrants.source, "admin")))).map((row) => ({ channelId: row.channelId, source: row.source, enabled: row.enabled, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null })).sort((a, b) => a.channelId.localeCompare(b.channelId));
    assert.deepEqual(grantsAfter, grantsBefore);
    assert.equal((await v2Db.select().from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, LOCATION_ID))).length, 0, "no test visibility rows remain");
    console.info("V2 staging visibility lifecycle PASS: current Base/grants unchanged; Divnitsa visible→hidden(absent)→visible/playable(admin); unauthenticated/device-only=401, cross-origin=403; catalog=11/32/31; journal=9.");
  } catch (error) {
    if (mutationStarted && origin && basic) {
      try {
        const body = new FormData(); body.set("operation", "show-channel"); body.set("locationId", LOCATION_ID); body.set("channelId", DIVNITSA_ID);
        await fetch(`${origin}/api/v2/admin/access`, { method: "POST", headers: { Origin: origin, Accept: "application/json", Authorization: basic }, body });
      } catch { /* The final manual state check must catch a failed restoration. */ }
    }
    throw error;
  } finally { await v2Pool.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
