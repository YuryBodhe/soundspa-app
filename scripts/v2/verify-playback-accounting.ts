// Staging-only transactional verification for Gate 4C hourly playback accounting.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels, deviceCurrentState, devices, hourlyChannelPlayback, hourlyDevicePlayback, locations, organizations } from "../../db/v2/schema";
import { acceptMonitoringSnapshot, beginMonitoringSession } from "../../db/v2/services/monitoringSessions";
import type { MonitoringLaneSignal } from "../../db/v2/services/monitoringSessions";

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize this isolated verification.");
  const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
  assert.equal(target.rows[0]?.database, "soundspa_v2");
  assert.equal(target.rows[0]?.user, "soundspa_v2");
  const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
  assert.equal(journal.rows[0]?.count, 10);
  const [musicChannel] = await v2Db.select({ id: channels.id }).from(channels)
    .where(eq(channels.kind, "music")).orderBy(asc(channels.sortOrder), asc(channels.id)).limit(1);
  const [ambientChannel] = await v2Db.select({ id: channels.id }).from(channels)
    .where(eq(channels.kind, "ambient")).orderBy(asc(channels.sortOrder), asc(channels.id)).limit(1);
  assert(musicChannel && ambientChannel, "staging requires existing Music and Ambient Channels");

  const suffix = randomUUID();
  const organizationIds: string[] = [];
  const locationIds: string[] = [];
  const deviceIds: string[] = [];
  let syntheticDeviceId: string | null = null;

  try {
    const [organization] = await v2Db.insert(organizations).values({ name: `gate4c-accounting-${suffix}` }).returning({ id: organizations.id });
    organizationIds.push(organization.id);
    const [location] = await v2Db.insert(locations).values({
      organizationId: organization.id,
      name: "Gate 4C accounting verification",
      slug: `gate4c-accounting-${suffix}`,
      timezone: "UTC",
    }).returning({ id: locations.id });
    locationIds.push(location.id);
    const credential = `${randomUUID()}${randomUUID()}`;
    const [device] = await v2Db.insert(devices).values({
      locationId: location.id,
      label: `gate4c-accounting-${suffix}`,
      status: "active",
      credentialHash: createHash("sha256").update(credential, "utf8").digest("hex"),
    }).returning({ id: devices.id });
    syntheticDeviceId = device.id;
    deviceIds.push(device.id);

    const rowSum = async (table: typeof hourlyDevicePlayback | typeof hourlyChannelPlayback, lane?: "music" | "ambient") => {
      if (table === hourlyDevicePlayback) {
        const [row] = await v2Db.select({ total: sql<number>`coalesce(sum(${hourlyDevicePlayback.activePlaybackSeconds}), 0)::int` })
          .from(hourlyDevicePlayback).where(eq(hourlyDevicePlayback.deviceId, device.id));
        return row?.total ?? 0;
      }
      const [row] = await v2Db.select({ total: sql<number>`coalesce(sum(${hourlyChannelPlayback.playedSeconds}), 0)::int` })
        .from(hourlyChannelPlayback).where(sql`${hourlyChannelPlayback.deviceId} = ${device.id} AND ${hourlyChannelPlayback.lane} = ${lane}`);
      return row?.total ?? 0;
    };

    let logicalMs = Date.now() + 10_000;
    let session = await beginMonitoringSession(device.id);
    const send = (seqMusic: number, musicState: MonitoringLaneSignal["state"], musicId: string | null,
      seqAmbient: number, ambientState: MonitoringLaneSignal["state"], ambientId: string | null,
      atMs: number, current = session) => acceptMonitoringSnapshot({
      deviceId: device.id,
      generation: current.generation,
      sessionId: current.sessionId,
      music: { sequence: seqMusic, state: musicState, channelId: musicId },
      ambient: { sequence: seqAmbient, state: ambientState, channelId: ambientId },
    }, async () => new Date(atMs));

    // First signal establishes this session's baseline; it must not bridge old state.
    let result = await send(1, "playing", musicChannel.id, 1, "idle", null, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    assert.equal(await rowSum(hourlyDevicePlayback), 0, "first signal has no historical credit");
    logicalMs += 120_000;
    result = await send(2, "paused", musicChannel.id, 2, "idle", null, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    assert.equal(await rowSum(hourlyDevicePlayback), 120, "Music only contributes 120 Player Active seconds");
    assert.equal(await rowSum(hourlyChannelPlayback, "music"), 120);
    assert.equal(await rowSum(hourlyChannelPlayback, "ambient"), 0);

    logicalMs += 60 * 60_000;
    session = await beginMonitoringSession(device.id);
    result = await send(1, "idle", null, 1, "playing", ambientChannel.id, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    const ambientBaselineActive = await rowSum(hourlyDevicePlayback);
    const ambientBaselineMusic = await rowSum(hourlyChannelPlayback, "music");
    const ambientBaselineAmbient = await rowSum(hourlyChannelPlayback, "ambient");
    logicalMs += 120_000;
    result = await send(2, "idle", null, 2, "paused", ambientChannel.id, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    assert.equal(await rowSum(hourlyDevicePlayback) - ambientBaselineActive, 120, "Ambient only contributes 120 Player Active seconds");
    assert.equal(await rowSum(hourlyChannelPlayback, "music") - ambientBaselineMusic, 0);
    assert.equal(await rowSum(hourlyChannelPlayback, "ambient") - ambientBaselineAmbient, 120);

    logicalMs += 60 * 60_000;
    session = await beginMonitoringSession(device.id);
    result = await send(1, "playing", musicChannel.id, 1, "playing", ambientChannel.id, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    const bothBaselineActive = await rowSum(hourlyDevicePlayback);
    const bothBaselineMusic = await rowSum(hourlyChannelPlayback, "music");
    const bothBaselineAmbient = await rowSum(hourlyChannelPlayback, "ambient");
    logicalMs += 120_000;
    result = await send(2, "idle", musicChannel.id, 2, "idle", ambientChannel.id, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    assert.equal(await rowSum(hourlyDevicePlayback) - bothBaselineActive, 120, "overlapping lanes count Player Active once");
    assert.equal(await rowSum(hourlyChannelPlayback, "music") - bothBaselineMusic, 120);
    assert.equal(await rowSum(hourlyChannelPlayback, "ambient") - bothBaselineAmbient, 120);

    logicalMs += 60 * 60_000;
    session = await beginMonitoringSession(device.id);
    result = await send(1, "playing", musicChannel.id, 1, "idle", null, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    const cappedBaseline = await rowSum(hourlyDevicePlayback);
    logicalMs += 600_000;
    result = await send(2, "paused", musicChannel.id, 2, "idle", null, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    assert.equal(await rowSum(hourlyDevicePlayback) - cappedBaseline, 180, "600s delayed heartbeat credits only the 180s cap");

    // A new session's first signal is a fresh baseline, never a bridge from the old one.
    logicalMs += 60 * 60_000;
    session = await beginMonitoringSession(device.id);
    result = await send(1, "playing", musicChannel.id, 1, "idle", null, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    const sessionBoundaryBaseline = await rowSum(hourlyDevicePlayback);
    const oldSession = session;
    logicalMs += 60_000;
    session = await beginMonitoringSession(device.id);
    const freshSession = session;
    const activeBeforeStale = await rowSum(hourlyDevicePlayback);
    const [currentBeforeStale] = await v2Db.select({
      generation: deviceCurrentState.monitoringGeneration,
      musicSessionId: deviceCurrentState.musicSessionId,
      musicSequence: deviceCurrentState.musicSequence,
      ambientSessionId: deviceCurrentState.ambientSessionId,
      ambientSequence: deviceCurrentState.ambientSequence,
      lastSeenAt: deviceCurrentState.lastSeenAt,
    }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, device.id));
    result = await send(2, "paused", musicChannel.id, 2, "idle", null, logicalMs, oldSession);
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "stale session is rejected without accounting");
    const [currentAfterStale] = await v2Db.select({
      generation: deviceCurrentState.monitoringGeneration,
      musicSessionId: deviceCurrentState.musicSessionId,
      musicSequence: deviceCurrentState.musicSequence,
      ambientSessionId: deviceCurrentState.ambientSessionId,
      ambientSequence: deviceCurrentState.ambientSequence,
      lastSeenAt: deviceCurrentState.lastSeenAt,
    }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, device.id));
    assert.deepEqual(currentAfterStale, currentBeforeStale, "stale session cannot overwrite current state or last_seen");
    assert.equal(await rowSum(hourlyDevicePlayback), activeBeforeStale, "stale session contributes zero accounting");
    result = await send(1, "idle", null, 1, "idle", null, logicalMs + 60_000, freshSession);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    assert.equal(await rowSum(hourlyDevicePlayback), sessionBoundaryBaseline, "no interval is bridged across session generation");

    // Concurrent same-device signals serialize on device_current_state. Whether
    // sequence 2 or 3 wins the lock first, their shared previous interval is once.
    logicalMs += 60 * 60_000;
    session = await beginMonitoringSession(device.id);
    result = await send(1, "playing", musicChannel.id, 1, "idle", null, logicalMs);
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    const concurrentBaseline = await rowSum(hourlyDevicePlayback);
    const startMs = logicalMs;
    const concurrent = await Promise.all([
      send(2, "playing", musicChannel.id, 2, "idle", null, startMs + 60_000),
      send(3, "playing", musicChannel.id, 3, "idle", null, startMs + 120_000),
    ]);
    assert(concurrent.some((item) => item.accepted.music), "one or both in-order signals accepted");
    assert.equal(await rowSum(hourlyDevicePlayback) - concurrentBaseline, 120, "concurrent signals cannot double-credit their interval");
    const beforeDuplicate = await rowSum(hourlyDevicePlayback);
    result = await send(3, "paused", musicChannel.id, 3, "idle", null, startMs + 300_000);
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "duplicate sequence contributes zero");
    assert.equal(await rowSum(hourlyDevicePlayback), beforeDuplicate);
    result = await send(2, "paused", musicChannel.id, 2, "idle", null, startMs + 300_000);
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "out-of-order sequence contributes zero");
    assert.equal(await rowSum(hourlyDevicePlayback), beforeDuplicate);

    const state = await v2Db.execute(sql`SELECT last_seen_at, last_playback_at FROM device_current_state WHERE device_id = ${device.id}`);
    assert.equal(state.rows.length, 1, "test activity is stored only as current state and compact hourly aggregates");
    const events = await v2Db.execute(sql`SELECT count(*)::int AS count FROM device_events WHERE device_id = ${device.id}`);
    assert.equal(events.rows[0]?.count, 0, "no per-signal Device events are written");
  } finally {
    if (syntheticDeviceId) {
      await v2Db.delete(hourlyChannelPlayback).where(eq(hourlyChannelPlayback.deviceId, syntheticDeviceId));
      await v2Db.delete(hourlyDevicePlayback).where(eq(hourlyDevicePlayback.deviceId, syntheticDeviceId));
      await v2Db.delete(devices).where(eq(devices.id, syntheticDeviceId));
    }
    if (locationIds.length) await v2Db.delete(locations).where(inArray(locations.id, locationIds));
    if (organizationIds.length) await v2Db.delete(organizations).where(inArray(organizations.id, organizationIds));
    if (syntheticDeviceId) {
      const [leftover] = await v2Db.select({ id: devices.id }).from(devices).where(eq(devices.id, syntheticDeviceId));
      assert.equal(leftover, undefined, "synthetic Device must be removed");
    }
    await v2Pool.end();
  }
}

main().then(() => console.info("PASS: staging transactional hourly accounting, lane/union semantics, freshness cap, session boundary, concurrent idempotency and cleanup."))
  .catch((error) => { console.error(error); process.exitCode = 1; });
