import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { baseChannels, channelTracks, channels, locationChannelEntitlements, locationChannelGrants, locationChannelVisibility, locationServiceAccess, locations, organizations } from "../../db/v2/schema";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { upsertLocationAdminGrant } from "../../db/v2/queries/adminGrants";
import { filterVisibleChannels, getHiddenChannelIds, hideChannelForLocation, showChannelForLocation } from "../../db/v2/queries/locationChannelVisibility";

class VerificationRollback extends Error {}

async function main() {
  let organizationId = ""; let locationA = ""; let locationB = ""; let locationSuspended = ""; let channelIds: string[] = [];
  try {
    const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
    assert.equal(target.rows[0]?.database, "soundspa_v2"); assert.equal(target.rows[0]?.user, "soundspa_v2");
    const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
    assert.equal(journal.rows[0]?.count, 7);

    try {
      await v2Db.transaction(async (tx) => {
        const now = new Date(); const future = new Date(now.getTime() + 60_000); const suffix = randomUUID();
        const [org] = await tx.insert(organizations).values({ name: `visibility-${suffix}` }).returning();
        organizationId = org.id;
        const makeLocation = async (name: string) => (await tx.insert(locations).values({ organizationId: org.id, name, slug: `visibility-${name.toLowerCase()}-${suffix}`, timezone: "UTC" }).returning())[0];
        const a = await makeLocation("A"); const b = await makeLocation("B"); const suspended = await makeLocation("Suspended");
        locationA = a.id; locationB = b.id; locationSuspended = suspended.id;
        const makeChannel = async (slug: string, kind: "music" | "ambient", published = true) => {
          const [channel] = await tx.insert(channels).values({ slug: `${slug}-${suffix}`, displayName: slug, kind, isPublished: published }).returning();
          channelIds.push(channel.id);
          await tx.insert(channelTracks).values({ channelId: channel.id, storageKey: `visibility/${suffix}/${slug}.mp3`, originalFilename: `${slug}.mp3`, sizeBytes: BigInt(1), sortOrder: 0 });
          return channel;
        };
        const lockedMusic = await makeChannel("locked-music", "music");
        const adminMusic = await makeChannel("admin-music", "music");
        const baseAmbient = await makeChannel("base-ambient", "ambient");
        const includedMusic = await makeChannel("included-music", "music");
        const previewAmbient = await makeChannel("preview-ambient", "ambient");
        const subscribedMusic = await makeChannel("subscribed-music", "music");
        const unpublishedMusic = await makeChannel("unpublished-music", "music", false);
        await tx.insert(baseChannels).values({ channelId: baseAmbient.id });
        await tx.insert(locationChannelEntitlements).values([
          { locationId: a.id, channelId: includedMusic.id, accessType: "included" },
          { locationId: a.id, channelId: previewAmbient.id, accessType: "preview", expiresAt: future },
          { locationId: a.id, channelId: subscribedMusic.id, accessType: "subscribed" },
        ]);
        await tx.insert(locationServiceAccess).values({ locationId: a.id, paidThrough: future });
        await upsertLocationAdminGrant({ locationId: a.id, channelId: adminMusic.id }, tx);
        await tx.insert(locationServiceAccess).values({ locationId: suspended.id, trialEndsAt: future, suspendedAt: now });

        const catalog = async (locationId: string) => {
          const [effective, hidden] = await Promise.all([resolveEffectiveChannelAccess(locationId, now, tx), getHiddenChannelIds(locationId, tx)]);
          return filterVisibleChannels(effective, hidden);
        };
        const find = async (locationId: string, id: string) => (await catalog(locationId)).find((channel) => channel.id === id);

        // A/L: default visible locked channel stays present with safe metadata only.
        let item = await find(a.id, lockedMusic.id); assert(item); assert.equal(item.playable, false); assert.deepEqual(item.tracks, []);
        // B/M/Q: hidden locked channel is absent, and both media kinds use the same policy.
        await hideChannelForLocation(a.id, lockedMusic.id, tx); assert.equal(await find(a.id, lockedMusic.id), undefined);
        await showChannelForLocation(a.id, lockedMusic.id, tx); assert(await find(a.id, lockedMusic.id));
        await hideChannelForLocation(a.id, baseAmbient.id, tx); assert.equal(await find(a.id, baseAmbient.id), undefined);
        // G/O/P/R: global Base and other Locations remain unchanged; show restores Base access.
        item = await find(b.id, baseAmbient.id); assert(item?.playable); assert(item.accessSources.includes("base"));
        await showChannelForLocation(a.id, baseAmbient.id, tx); item = await find(a.id, baseAmbient.id); assert(item?.playable); assert(item.accessSources.includes("base"));
        // C/D/E: Admin access disappears from the DTO while hidden and returns unchanged on show.
        item = await find(a.id, adminMusic.id); assert(item?.playable); assert(item.accessSources.includes("admin"));
        const [grantBefore] = await tx.select().from(locationChannelGrants).where(eq(locationChannelGrants.channelId, adminMusic.id));
        await hideChannelForLocation(a.id, adminMusic.id, tx); assert.equal(await find(a.id, adminMusic.id), undefined);
        assert.deepEqual(await tx.select().from(locationChannelGrants).where(eq(locationChannelGrants.channelId, adminMusic.id)), [grantBefore]);
        await showChannelForLocation(a.id, adminMusic.id, tx); item = await find(a.id, adminMusic.id); assert(item?.playable); assert(item.accessSources.includes("admin"));
        // I: hiding included/preview/subscribed sources never deletes their source rows.
        for (const channel of [includedMusic, previewAmbient, subscribedMusic]) {
          await hideChannelForLocation(a.id, channel.id, tx); assert.equal(await find(a.id, channel.id), undefined);
          assert.equal((await tx.select().from(locationChannelEntitlements).where(eq(locationChannelEntitlements.channelId, channel.id))).length, 1);
          await showChannelForLocation(a.id, channel.id, tx); assert(await find(a.id, channel.id));
        }
        assert.equal((await tx.select().from(locationChannelEntitlements).where(eq(locationChannelEntitlements.channelId, adminMusic.id))).length, 0);
        // J/K: suspension remains authoritative for visible channels and does not change when hidden.
        item = await find(suspended.id, baseAmbient.id); assert(item); assert.equal(item.suspended, true); assert.equal(item.playable, false); assert.deepEqual(item.tracks, []);
        await hideChannelForLocation(suspended.id, baseAmbient.id, tx); assert.equal(await find(suspended.id, baseAmbient.id), undefined); await showChannelForLocation(suspended.id, baseAmbient.id, tx);
        item = await find(suspended.id, baseAmbient.id); assert(item); assert.equal(item.suspended, true); assert.equal(item.playable, false);
        // F: included, preview, and subscribed remain independently playable when visible.
        for (const channel of [includedMusic, previewAmbient, subscribedMusic, adminMusic]) assert.equal((await find(a.id, channel.id))?.playable, true);
        // N: hide/show are deterministic and idempotent; row presence is the only hidden state.
        await hideChannelForLocation(a.id, lockedMusic.id, tx); await hideChannelForLocation(a.id, lockedMusic.id, tx);
        assert.equal((await tx.select().from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, a.id))).filter((row) => row.channelId === lockedMusic.id).length, 1);
        await showChannelForLocation(a.id, lockedMusic.id, tx); await showChannelForLocation(a.id, lockedMusic.id, tx);
        assert.equal((await tx.select().from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, a.id))).filter((row) => row.channelId === lockedMusic.id).length, 0);
        // Unpublished channels remain excluded by the existing published catalog query.
        assert.equal(await find(a.id, unpublishedMusic.id), undefined);
        // S: the entire synthetic test is transaction-scoped and rolled back.
        throw new VerificationRollback();
      });
    } catch (error) { if (!(error instanceof VerificationRollback)) throw error; }

    for (const id of [locationA, locationB, locationSuspended]) {
      assert(id);
      assert.equal((await v2Db.select().from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, id))).length, 0);
      assert.equal((await v2Db.select().from(locations).where(eq(locations.id, id))).length, 0);
    }
    assert(organizationId);
    assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
    for (const id of channelIds) assert.equal((await v2Db.select().from(channels).where(eq(channels.id, id))).length, 0);
    console.info("V2 Location Channel Visibility PASS: default-visible/locked, hidden omission, Base/Admin/entitlement independence, restore, suspension, idempotency, Location isolation, music/ambient, rollback; journal=7.");
  } finally { await v2Pool.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
