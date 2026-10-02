// Explicit staging verification. All synthetic rows are created in one transaction and rolled back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  channels, deviceCurrentState, deviceEvents, devices, locations, monitoringLifecycleEvents, organizations,
} from "../../db/v2/schema";

class VerificationRollback extends Error {}

async function main() {
  try {
    const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
    assert.equal(target.rows[0]?.database, "soundspa_v2");
    assert.equal(target.rows[0]?.user, "soundspa_v2");
    const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
    assert.equal(journal.rows[0]?.count, 9);
    const before = await v2Db.execute(sql`SELECT
      (SELECT count(*)::int FROM devices) AS devices,
      (SELECT count(*)::int FROM device_current_state) AS current_states,
      (SELECT count(*)::int FROM device_events) AS device_events`);
    const [channel] = await v2Db.select({ id: channels.id }).from(channels).orderBy(channels.id).limit(1);
    assert(channel, "a seeded channel is required for a scoped foundation test");

    try {
      await v2Db.transaction(async (tx) => {
        const suffix = randomUUID();
        const [organization] = await tx.insert(organizations).values({ name: `monitoring-${suffix}` }).returning({ id: organizations.id });
        const [location] = await tx.insert(locations).values({
          organizationId: organization.id, name: "Monitoring verification", slug: `monitoring-${suffix}`, timezone: "UTC",
        }).returning({ id: locations.id });
        const [device] = await tx.insert(devices).values({ locationId: location.id, label: "Monitoring verification" }).returning({ id: devices.id });

        await tx.insert(deviceCurrentState).values({
          deviceId: device.id, musicPlaybackState: "playing", musicCurrentChannelId: channel.id,
          musicSessionId: randomUUID(), musicSequence: 2,
          ambientPlaybackState: "playing", ambientCurrentChannelId: channel.id,
          ambientSessionId: randomUUID(), ambientSequence: 5,
        });
        const [bothLanes] = await tx.select({
          music: deviceCurrentState.musicPlaybackState, ambient: deviceCurrentState.ambientPlaybackState,
          musicChannel: deviceCurrentState.musicCurrentChannelId, ambientChannel: deviceCurrentState.ambientCurrentChannelId,
        }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, device.id));
        assert.deepEqual(bothLanes, { music: "playing", ambient: "playing", musicChannel: channel.id, ambientChannel: channel.id });

        const utcHour = sql`date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
        await tx.execute(sql`INSERT INTO hourly_channel_playback(bucket_start,device_id,channel_id,lane,played_seconds) VALUES (${utcHour},${device.id},${channel.id},'music',1),(${utcHour},${device.id},${channel.id},'ambient',1)`);
        await expectConstraint(tx, "23505", sql`INSERT INTO hourly_channel_playback(bucket_start,device_id,channel_id,lane,played_seconds) VALUES (${utcHour},${device.id},${channel.id},'music',1)`);
        await expectConstraint(tx, "23514", sql`INSERT INTO hourly_channel_playback(bucket_start,device_id,channel_id,lane,played_seconds) VALUES (${utcHour},${device.id},${channel.id},'ambient',-1)`);

        await tx.execute(sql`INSERT INTO hourly_device_playback(bucket_start,device_id,active_playback_seconds) VALUES (${utcHour},${device.id},1)`);
        await expectConstraint(tx, "23505", sql`INSERT INTO hourly_device_playback(bucket_start,device_id,active_playback_seconds) VALUES (${utcHour},${device.id},1)`);
        await expectConstraint(tx, "23514", sql`INSERT INTO hourly_device_playback(bucket_start,device_id,active_playback_seconds) VALUES (${utcHour} + interval '1 hour',${device.id},3601)`);

        await tx.execute(sql`INSERT INTO hourly_error_aggregates(bucket_start,category,error_code,device_id) VALUES (${utcHour},'PLAYBACK','MEDIA_UNAVAILABLE',${device.id}),(${utcHour},'PLAYBACK','MEDIA_UNAVAILABLE',NULL)`);
        await expectConstraint(tx, "23505", sql`INSERT INTO hourly_error_aggregates(bucket_start,category,error_code,device_id) VALUES (${utcHour},'PLAYBACK','MEDIA_UNAVAILABLE',NULL)`);
        await expectConstraint(tx, "23505", sql`INSERT INTO hourly_error_aggregates(bucket_start,category,error_code,device_id) VALUES (${utcHour},'PLAYBACK','MEDIA_UNAVAILABLE',${device.id})`);
        await expectConstraint(tx, "23514", sql`INSERT INTO hourly_error_aggregates(bucket_start,category,error_code,device_id) VALUES (${utcHour},'PLAYBACK','unsafe message',${device.id})`);

        const [event] = await tx.insert(monitoringLifecycleEvents).values({
          eventType: "device_created", organizationId: organization.id, organizationName: `monitoring-${suffix}`,
          locationId: location.id, locationName: "Monitoring verification", deviceId: device.id, deviceLabel: "Monitoring verification",
        }).returning({ id: monitoringLifecycleEvents.id });
        await tx.insert(deviceEvents).values({ deviceId: device.id, eventType: "session_started", channelId: channel.id });
        await tx.delete(devices).where(eq(devices.id, device.id));
        await tx.delete(locations).where(eq(locations.id, location.id));
        await tx.delete(organizations).where(eq(organizations.id, organization.id));
        assert.equal((await tx.select({ id: monitoringLifecycleEvents.id }).from(monitoringLifecycleEvents).where(eq(monitoringLifecycleEvents.id, event.id))).length, 1);
        throw new VerificationRollback();
      });
    } catch (error) {
      if (!(error instanceof VerificationRollback)) throw error;
    }

    const after = await v2Db.execute(sql`SELECT
      (SELECT count(*)::int FROM devices) AS devices,
      (SELECT count(*)::int FROM device_current_state) AS current_states,
      (SELECT count(*)::int FROM device_events) AS device_events`);
    assert.deepEqual(after.rows[0], before.rows[0], "all synthetic Device/state/event rows must be rolled back");
    console.info("V2 Monitoring foundation verification PASS; target soundspa_v2; journal=9; synthetic rows rolled back.");
  } finally {
    await v2Pool.end();
  }
}

async function expectConstraint(tx: Parameters<Parameters<typeof v2Db.transaction>[0]>[0], code: string, statement: ReturnType<typeof sql>) {
  await assert.rejects(tx.transaction(async (savepoint) => { await savepoint.execute(statement); }), (error: unknown) => {
    const candidate = error as { code?: string; cause?: { code?: string } };
    return (candidate.cause?.code ?? candidate.code) === code;
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
