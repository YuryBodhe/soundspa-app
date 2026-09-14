import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels, channelTracks } from "../../db/v2/schema";
import { contentAdminService, ContentValidationError } from "../../db/v2/services/contentAdmin";
import { listAdminChannels, getAdminChannel } from "../../db/v2/queries/contentAdmin";

async function verify() {
  const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
  assert.deepEqual(target.rows[0], { database: "soundspa_v2", user: "soundspa_v2" });
  const snapshot = async () => (await v2Db.execute(sql`SELECT
    (SELECT count(*)::int FROM channels) AS channels,
    (SELECT count(*)::int FROM channel_tracks) AS tracks,
    (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations,
    (SELECT count(*)::int FROM location_service_access) AS service,
    (SELECT count(*)::int FROM location_channel_entitlements) AS entitlements,
    (SELECT md5(string_agg(row_to_json(c)::text, ',' ORDER BY id)) FROM channels c) AS channel_fingerprint,
    (SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY id)) FROM channel_tracks t) AS track_fingerprint`)).rows[0];
  const before = await snapshot();
  assert.equal(before.channels, Number(process.env.V2_TEST_CHANNELS??6)); assert.equal(before.tracks, Number(process.env.V2_TEST_TRACKS??8)); assert.equal(before.migrations, 3);
  assert.equal(before.service, 0); assert.equal(before.entitlements, 0);
  assert.equal((await listAdminChannels()).length, before.channels);
  for (const channel of await listAdminChannels()) if(channel.isPublished)assert((await getAdminChannel(channel.id))?.tracks.length);
  const rollback = new Error("ROLLBACK_CONTENT_ADMIN_VERIFICATION"); let complete = false;
  try {
    await v2Db.transaction(async (tx) => {
      // Phase 1 state tests use no physical files; Phase 2 verifies actual files separately.
      const service = contentAdminService(tx, async()=>{});
      const input = { displayName: "Synthetic Content Verification", slug: `verify-${randomUUID()}`, kind: "music" as const, description: "", imageKey: "", sortOrder: 0 };
      const channel = await service.create(input); assert.equal(channel.isPublished, false);
      await assert.rejects(service.publication(channel.id, true), /Artwork image key/);
      const edited = { ...input, slug: `edited-${randomUUID()}`, displayName: "Synthetic Edited", imageKey: "artwork/synthetic.jpg", description: "Synthetic description", sortOrder: 2 };
      await service.edit(channel.id, edited);
      await assert.rejects(service.publication(channel.id, true), /enabled track/);
      const [track] = await tx.insert(channelTracks).values({ channelId: channel.id, storageKey: `music/verify/${randomUUID()}.mp3`, originalFilename: "synthetic.mp3", sizeBytes: BigInt(1), sortOrder: 0 }).returning();
      await assert.rejects(service.edit(channel.id, { ...edited, slug: `blocked-${randomUUID()}` }), /Slug is immutable/);
      await assert.rejects(service.edit(channel.id, { ...edited, kind: "ambient" }), /Kind cannot change/);
      await service.publication(channel.id, true);
      await assert.rejects(service.track(channel.id, track.id, false, 0), /last enabled track/);
      await service.publication(channel.id, false);
      await service.track(channel.id, track.id, false, 4);
      await assert.rejects(service.publication(channel.id, true), /enabled track/);
      await service.track(channel.id, track.id, true, 3);
      await assert.rejects(service.track(channel.id, randomUUID(), true, 0), ContentValidationError);
      await service.publication(channel.id, true);
      await service.archive(channel.id);
      await assert.rejects(service.publication(channel.id, true), /Archived/);
      await assert.rejects(service.edit(channel.id, edited), /Archived/);
      const result = await tx.execute(sql`SELECT is_published, archived_at FROM channels WHERE id=${channel.id}::uuid`);
      assert.equal(result.rows[0].is_published, false); assert(result.rows[0].archived_at);
      const trackResult = await tx.execute(sql`SELECT is_enabled, sort_order FROM channel_tracks WHERE id=${track.id}::uuid`);
      assert.equal(trackResult.rows[0].is_enabled, true); assert.equal(trackResult.rows[0].sort_order, 3);
      complete = true; throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  assert(complete); assert.deepEqual(await snapshot(), before);
  console.info("PASS: actual V2 target, six-channel Admin queries, synthetic create/edit/slug/track/publish/unpublish/archive; full rollback and unchanged 6/8, journal 3, Access 0/0, exact seeded fingerprints.");
}
verify().catch((error) => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; }).finally(() => v2Pool.end());
