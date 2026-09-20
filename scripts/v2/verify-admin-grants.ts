import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { organizations, locations, channels, channelTracks, locationChannelGrants, baseChannels, locationChannelEntitlements, locationServiceAccess } from "../../db/v2/schema";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { disableLocationAdminGrant, removeLocationAdminGrant, upsertLocationAdminGrant } from "../../db/v2/queries/adminGrants";

class Rollback extends Error {}
async function main() {
  let orgId = "", locationId = "", adminChannel = "", otherChannel = "";
  try {
    try { await v2Db.transaction(async (tx) => {
      const now = new Date(), future = new Date(now.getTime() + 60_000), past = new Date(now.getTime() - 60_000), suffix = randomUUID();
      const [org] = await tx.insert(organizations).values({ name: `admin-grants-${suffix}` }).returning(); orgId = org.id;
      const [loc] = await tx.insert(locations).values({ organizationId: org.id, name: "Admin Grants", slug: `admin-grants-${suffix}`, timezone: "UTC" }).returning(); locationId = loc.id;
      const make = async (name: string) => { const [c] = await tx.insert(channels).values({ slug: `${name}-${suffix}`, displayName: name, kind: "music", isPublished: true }).returning(); await tx.insert(channelTracks).values({ channelId: c.id, storageKey: `synthetic/${suffix}/${name}.mp3`, originalFilename: `${name}.mp3`, sizeBytes: BigInt(1), sortOrder: 0 }); return c.id; };
      adminChannel = await make("admin"); otherChannel = await make("other");
      const get = async (id: string) => (await resolveEffectiveChannelAccess(locationId, now, tx)).find((c) => c.id === id)!;
      assert.equal((await get(adminChannel)).playable, false); // A
      await upsertLocationAdminGrant({ locationId, channelId: adminChannel }, tx);
      let c = await get(adminChannel); assert.equal(c.playable, true); assert.deepEqual(c.accessSources, ["admin"]); assert.deepEqual(c.underlyingSources, ["admin"]); // B/Q
      await upsertLocationAdminGrant({ locationId, channelId: otherChannel, startsAt: future }, tx); assert.equal((await get(otherChannel)).playable, false); // C
      await upsertLocationAdminGrant({ locationId, channelId: otherChannel, startsAt: null, endsAt: past }, tx); assert.equal((await get(otherChannel)).playable, false); // D
      await upsertLocationAdminGrant({ locationId, channelId: otherChannel, enabled: false }, tx); assert.equal((await get(otherChannel)).playable, false); // E
      await tx.insert(baseChannels).values({ channelId: adminChannel }); c = await get(adminChannel); assert.deepEqual(c.accessSources, ["base", "admin"]); // F
      await tx.insert(locationChannelEntitlements).values({ locationId, channelId: otherChannel, accessType: "included" }); await upsertLocationAdminGrant({ locationId, channelId: otherChannel }, tx); c = await get(otherChannel); assert.deepEqual(c.accessSources, ["included", "admin"]); // G
      await tx.update(locationChannelEntitlements).set({ accessType: "preview", expiresAt: future }).where(eq(locationChannelEntitlements.channelId, otherChannel)); c = await get(otherChannel); assert.deepEqual(c.accessSources, ["preview", "admin"]); // H
      await tx.update(locationChannelEntitlements).set({ accessType: "subscribed", expiresAt: null }).where(eq(locationChannelEntitlements.channelId, otherChannel)); c = await get(otherChannel); assert.deepEqual(c.accessSources, ["admin"]); // I/J without service
      const same = await upsertLocationAdminGrant({ locationId, channelId: adminChannel }, tx); assert.equal(same.id, (await upsertLocationAdminGrant({ locationId, channelId: adminChannel }, tx)).id); // R
      await tx.update(locationChannelGrants).set({ endsAt: past }).where(eq(locationChannelGrants.channelId, adminChannel)); c = await get(adminChannel); assert.deepEqual(c.accessSources, ["base"]); // K
      await disableLocationAdminGrant(locationId, otherChannel, tx); c = await get(otherChannel); assert.deepEqual(c.accessSources, []); // S
      await upsertLocationAdminGrant({ locationId, channelId: otherChannel }, tx); await tx.update(locationChannelGrants).set({ enabled: true }).where(eq(locationChannelGrants.channelId, adminChannel));
      await tx.insert(locationServiceAccess).values({ locationId }); await tx.update(locationServiceAccess).set({ suspendedAt: now }).where(eq(locationServiceAccess.locationId, locationId));
      c = await get(otherChannel); assert.equal(c.playable, false); assert.deepEqual(c.underlyingSources, ["admin"]); assert.deepEqual(c.tracks, []); // L/M
      throw new Rollback();
    }); } catch (e) { if (!(e instanceof Rollback)) throw e; }
    assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, orgId))).length, 0);
    console.info("V2 Admin Grants verification PASS: active windows, source union/order, expiry, disable, duplicate prevention, suspension boundary, rollback.");
  } finally { await v2Pool.end(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
