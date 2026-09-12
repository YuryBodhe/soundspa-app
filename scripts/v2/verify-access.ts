// Explicit staging verification only; all synthetic data is rolled back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { organizations, locations, channels, channelTracks, locationServiceAccess, locationChannelEntitlements } from "../../db/v2/schema";
import { getLocationCatalog, getPlayableChannelsForLocation } from "../../db/v2/queries/access";

class VerificationRollback extends Error {}
async function main() {
  try {
    const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
    assert.equal(target.rows[0]?.database, "soundspa_v2");
    assert.equal(target.rows[0]?.user, "soundspa_v2");
    console.info("V2 Access target verified:", target.rows[0]);
    const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
    assert.equal(journal.rows[0]?.count, 3);
    let organizationId: string | undefined;
    let locationId: string | undefined;
    const channelIds: string[] = [];
    try {
      await v2Db.transaction(async (tx) => {
        const now = new Date();
        const future = new Date(now.getTime() + 60_000);
        const past = new Date(now.getTime() - 60_000);
        const suffix = randomUUID();
        const [org] = await tx.insert(organizations).values({ name: `access-sentinel-${suffix}` }).returning();
        organizationId = org.id;
        const [location] = await tx.insert(locations).values({ organizationId: org.id, name: "Access sentinel", slug: `access-${suffix}`, timezone: "UTC" }).returning();
        locationId = location.id;
        const names = ["included", "preview", "expired", "disabled", "locked", "unpublished", "subscribed", "no-tracks", "archived"] as const;
        const ids = new Map<string, string>();
        for (const name of names) {
          const [channel] = await tx.insert(channels).values({ slug: `${name}-${suffix}`, displayName: name, kind: name === "preview" ? "ambient" : "music", isPublished: name !== "unpublished", archivedAt: name === "archived" ? now : null }).returning();
          ids.set(name, channel.id);
          channelIds.push(channel.id);
          await tx.insert(channelTracks).values({ channelId: channel.id, storageKey: `synthetic/${suffix}/${name}.mp3`, originalFilename: `${name}.mp3`, sizeBytes: BigInt(1), sortOrder: 0, isEnabled: name !== "no-tracks" });
          if (name !== "locked") await tx.insert(locationChannelEntitlements).values({ locationId: location.id, channelId: channel.id,
            accessType: name === "preview" || name === "expired" ? "preview" : name === "subscribed" ? "subscribed" : "included",
            expiresAt: name === "preview" ? future : name === "expired" ? past : null, enabled: name !== "disabled" });
        }
        const playableNames = async () => (await getPlayableChannelsForLocation(location.id, now, tx)).map((c) => c.displayName).sort();
        assert.deepEqual(await playableNames(), []); // Missing service row denies access.
        await tx.insert(locationServiceAccess).values({ locationId: location.id, trialEndsAt: future });
        assert.deepEqual(await playableNames(), ["included", "preview", "subscribed"]);
        const catalog = await getLocationCatalog(location.id, now, tx);
        for (const name of ["included", "preview", "subscribed", "expired", "disabled", "locked"] as const) {
          const item = catalog.find((c) => c.displayName === name)!;
          assert.equal(item.access, name);
          if (["expired", "disabled", "locked"].includes(name)) assert.deepEqual(item.tracks, []);
        }
        assert(!catalog.some((c) => c.displayName === "unpublished" || c.displayName === "archived"));
        assert.equal(catalog.find((c) => c.displayName === "no-tracks")?.playable, false);
        console.info("PASS: included/preview/subscribed; expired/disabled/locked; published/archive/enabled tracks");
        await tx.update(locationServiceAccess).set({ trialEndsAt: past }).where(eq(locationServiceAccess.locationId, location.id));
        assert.deepEqual(await playableNames(), []);
        await tx.update(locationServiceAccess).set({ paidThrough: future }).where(eq(locationServiceAccess.locationId, location.id));
        assert.deepEqual(await playableNames(), ["included", "preview", "subscribed"]);
        await tx.update(locationServiceAccess).set({ suspendedAt: now }).where(eq(locationServiceAccess.locationId, location.id));
        assert.deepEqual(await playableNames(), []);
        assert((await getLocationCatalog(location.id, now, tx)).every((c) => c.tracks.length === 0));
        await tx.update(locationServiceAccess).set({ suspendedAt: null, paidThrough: now, trialEndsAt: now }).where(eq(locationServiceAccess.locationId, location.id));
        assert.deepEqual(await playableNames(), []); // Expiry equals serverNow is expired.
        await tx.update(locationServiceAccess).set({ paidThrough: future }).where(eq(locationServiceAccess.locationId, location.id));
        await tx.update(locations).set({ archivedAt: now }).where(eq(locations.id, location.id));
        assert.deepEqual(await getLocationCatalog(location.id, now, tx), []);
        await tx.update(locations).set({ archivedAt: null }).where(eq(locations.id, location.id));
        await tx.update(organizations).set({ archivedAt: now }).where(eq(organizations.id, org.id));
        assert.deepEqual(await getLocationCatalog(location.id, now, tx), []);
        console.info("PASS: absent/trial/paid/expired/suspended service; archived Location/Organization");
        const rejected = async (code: string, statement: ReturnType<typeof sql>) => {
          await assert.rejects(tx.transaction(async (savepoint) => { await savepoint.execute(statement); }),
            (error: unknown) => {
              const e = error as { code?: string; cause?: { code?: string } };
              return (e.cause?.code ?? e.code) === code;
            });
        };
        await rejected("23514", sql`UPDATE location_channel_entitlements SET access_type='preview', expires_at=NULL WHERE location_id=${location.id} AND channel_id=${ids.get("included")!}`);
        await rejected("23505", sql`INSERT INTO location_channel_entitlements(location_id,channel_id,access_type) VALUES (${location.id},${ids.get("included")!},'included')`);
        await rejected("23505", sql`INSERT INTO location_service_access(location_id) VALUES (${location.id})`);
        await rejected("23503", sql`INSERT INTO location_service_access(location_id) VALUES (${randomUUID()})`);
        await rejected("23503", sql`UPDATE location_channel_entitlements SET channel_id=${randomUUID()} WHERE location_id=${location.id} AND channel_id=${ids.get("included")!}`);
        await rejected("23503", sql`UPDATE location_channel_entitlements SET location_id=${randomUUID()} WHERE location_id=${location.id} AND channel_id=${ids.get("included")!}`);
        await rejected("23503", sql`DELETE FROM locations WHERE id=${location.id}`);
        // Remove the sentinel track first so this tests the entitlement's RESTRICT FK.
        await tx.delete(channelTracks).where(eq(channelTracks.channelId, ids.get("included")!));
        await rejected("23503", sql`DELETE FROM channels WHERE id=${ids.get("included")!}`);
        console.info("PASS: preview CHECK, composite PK, single service PK, all FK/RESTRICT checks; multiple entitlements coexist");
        throw new VerificationRollback();
      });
    } catch (error) {
      if (!(error instanceof VerificationRollback)) throw error;
    }
    assert(organizationId && locationId);
    assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
    assert.equal((await v2Db.select().from(locations).where(eq(locations.id, locationId))).length, 0);
    for (const id of channelIds) assert.equal((await v2Db.select().from(channels).where(eq(channels.id, id))).length, 0);
    console.info("V2 Access verification PASS; exact synthetic IDs absent after full transaction rollback; journal=3.");
  } finally { await v2Pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
