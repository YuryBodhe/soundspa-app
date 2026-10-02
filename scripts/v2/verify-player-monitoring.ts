// End-to-end verification of the Gate 4B dual-lane Player monitoring route.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { authenticateDeviceCredential } from "../../db/v2/queries/devices";
import { beginMonitoringSession } from "../../db/v2/services/monitoringSessions";
import { channels, deviceCurrentState, deviceEvents, devices, locations, organizations } from "../../db/v2/schema";
import type { MonitoringSignal } from "../../app/v2/playerMonitoring";

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize this isolated verification.");
  const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
  assert.equal(target.rows[0]?.database, "soundspa_v2");
  assert.equal(target.rows[0]?.user, "soundspa_v2");
  const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
  assert.equal(journal.rows[0]?.count, 10);
  const origin = process.env.V2_PUBLIC_ORIGIN;
  assert(origin, "V2_PUBLIC_ORIGIN must point at the isolated staging app.");
  const normalizedOrigin = new URL(origin).origin;
  const [musicChannels, ambientChannels] = await Promise.all([
    v2Db.select({ id: channels.id }).from(channels).where(eq(channels.kind, "music")).orderBy(asc(channels.sortOrder), asc(channels.id)).limit(2),
    v2Db.select({ id: channels.id }).from(channels).where(eq(channels.kind, "ambient")).orderBy(asc(channels.sortOrder), asc(channels.id)).limit(2),
  ]);
  assert(musicChannels.length >= 2 && ambientChannels.length >= 2, "staging requires two Music and two Ambient channels for lane/channel independence tests");

  const suffix = randomUUID();
  const organizationIds: string[] = [];
  const locationIds: string[] = [];
  const deviceIds: string[] = [];
  const credentialByDevice = new Map<string, string>();
  const musicA = musicChannels[0].id;
  const musicB = musicChannels[1].id;
  const ambientA = ambientChannels[0].id;
  const ambientB = ambientChannels[1].id;

  async function createDevice(label: string, status: "active" | "revoked" = "active") {
    const credential = `${randomUUID()}${randomUUID()}`;
    const credentialHash = createHash("sha256").update(credential, "utf8").digest("hex");
    const [device] = await v2Db.insert(devices).values({
      locationId: locationIds[0], label, status, credentialHash,
      revokedAt: status === "revoked" ? new Date() : null,
    }).returning({ id: devices.id });
    deviceIds.push(device.id);
    credentialByDevice.set(device.id, credential);
    return device.id;
  }

  const postHeartbeat = (credential: string | undefined, body: unknown, requestOrigin = normalizedOrigin) => fetch(`${normalizedOrigin}/api/v2/monitoring/heartbeat`, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json", ...(credential ? { cookie: `soundspa_v2_device=${credential}` } : {}) },
    body: JSON.stringify(body), cache: "no-store",
  });
  const postSession = (credential: string | undefined) => fetch(`${normalizedOrigin}/api/v2/monitoring/session`, {
    method: "POST", headers: { origin: normalizedOrigin, ...(credential ? { cookie: `soundspa_v2_device=${credential}` } : {}) }, cache: "no-store",
  });

  try {
    const [organization] = await v2Db.insert(organizations).values({ name: `player-monitoring-${suffix}` }).returning({ id: organizations.id });
    organizationIds.push(organization.id);
    const [location] = await v2Db.insert(locations).values({
      organizationId: organization.id, name: "Player monitoring verification", slug: `player-monitoring-${suffix}`, timezone: "UTC",
    }).returning({ id: locations.id });
    locationIds.push(location.id);
    const activeId = await createDevice("synthetic-active");
    const revokedId = await createDevice("synthetic-revoked", "revoked");
    const deletedId = await createDevice("synthetic-deleted");
    const activeCredential = credentialByDevice.get(activeId)!;
    assert.equal((await authenticateDeviceCredential(activeCredential))?.deviceId, activeId);
    assert.equal(await authenticateDeviceCredential(""), null);
    assert.equal(await authenticateDeviceCredential(randomUUID()), null);
    assert.equal(await authenticateDeviceCredential(credentialByDevice.get(revokedId)!), null);
    await v2Db.delete(devices).where(eq(devices.id, deletedId));

    const firstBody: Omit<MonitoringSignal, "sessionId" | "generation"> = {
      music: { sequence: 1, state: "idle", channelId: musicA },
      ambient: { sequence: 1, state: "idle", channelId: ambientA },
    };
    assert.equal((await postHeartbeat(undefined, firstBody)).status, 401, "missing device credential rejected");
    assert.equal((await postHeartbeat(randomUUID(), firstBody)).status, 401, "invalid device credential rejected");
    assert.equal((await postHeartbeat(credentialByDevice.get(revokedId), firstBody)).status, 401, "revoked Device rejected");
    assert.equal((await postHeartbeat(credentialByDevice.get(deletedId), firstBody)).status, 401, "deleted Device rejected");
    assert.equal((await postHeartbeat(activeCredential, firstBody, "https://cross-origin.invalid")).status, 403, "cross-origin mutation rejected");
    assert.equal((await postHeartbeat(activeCredential, firstBody)).status, 400, "session fields are required by the Gate 4B.1 protocol");

    const sessionResponse = await postSession(activeCredential);
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json() as { sessionId: string; generation: number };
    assert.match(session.sessionId, /^[0-9a-f-]{36}$/i);
    assert.equal(session.generation, 1);
    const signal = (musicSequence: number, musicState: MonitoringSignal["music"]["state"], musicChannel: string | null,
      ambientSequence: number, ambientState: MonitoringSignal["ambient"]["state"], ambientChannel: string | null,
      sessionId = session.sessionId, generation = session.generation): MonitoringSignal => ({
      sessionId, generation,
      music: { sequence: musicSequence, state: musicState, channelId: musicChannel },
      ambient: { sequence: ambientSequence, state: ambientState, channelId: ambientChannel },
    });
    const send = async (body: MonitoringSignal) => {
      const response = await postHeartbeat(activeCredential, body);
      assert.equal(response.status, 200, `heartbeat failed with ${response.status}`);
      return response.json() as Promise<{ accepted: { music: boolean; ambient: boolean } }>;
    };

    let result = await send(signal(1, "idle", musicA, 1, "idle", ambientA));
    assert.deepEqual(result.accepted, { music: true, ambient: true }, "initial independent lane snapshots accepted");
    let [state] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert.equal(state.musicCurrentChannelId, musicA);
    assert.equal(state.ambientCurrentChannelId, ambientA);
    assert.equal(state.musicPlaybackState, "idle");
    assert.equal(state.ambientPlaybackState, "idle");
    assert(state.lastSeenAt instanceof Date, "last_seen uses a server-created timestamp");
    assert.equal(state.lastPlaybackAt, null, "idle lanes do not set last_playback");

    result = await send(signal(2, "playing", musicA, 1, "idle", ambientA));
    assert.deepEqual(result.accepted, { music: true, ambient: false }, "MUSIC sequence advances independently");
    [state] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert.equal(state.musicPlaybackState, "playing");
    assert.equal(state.lastPlaybackAt instanceof Date, true, "actual-playing claim advances server last_playback");
    const musicPlaybackAt = state.lastPlaybackAt!.getTime();

    result = await send(signal(2, "paused", musicB, 2, "playing", ambientA));
    assert.deepEqual(result.accepted, { music: false, ambient: true }, "AMBIENT progresses while duplicate MUSIC sequence is ignored");
    [state] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert.equal(state.musicPlaybackState, "playing", "rejected lane has zero effect");
    assert.equal(state.ambientPlaybackState, "playing");
    assert(state.lastPlaybackAt!.getTime() >= musicPlaybackAt);

    result = await send(signal(3, "playing", musicB, 3, "playing", ambientA));
    assert.deepEqual(result.accepted, { music: true, ambient: true }, "both lanes can report playing simultaneously");
    result = await send(signal(4, "paused", musicB, 4, "paused", ambientB));
    assert.deepEqual(result.accepted, { music: true, ambient: true }, "independent channel/state transition accepted");
    [state] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert.equal(state.musicCurrentChannelId, musicB);
    assert.equal(state.ambientCurrentChannelId, ambientB);

    const sentinelLastPlayback = new Date("2001-01-01T00:00:00.000Z");
    await v2Db.update(deviceCurrentState).set({ lastPlaybackAt: sentinelLastPlayback }).where(eq(deviceCurrentState.deviceId, activeId));
    const beforeStoppedSignal = state.lastSeenAt.getTime();
    result = await send(signal(5, "idle", musicB, 5, "idle", ambientB));
    assert.deepEqual(result.accepted, { music: true, ambient: true });
    [state] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert(state.lastSeenAt.getTime() >= beforeStoppedSignal, "accepted signal advances last_seen using server time");
    assert.equal(state.lastPlaybackAt?.toISOString(), sentinelLastPlayback.toISOString(), "both stopped do not advance last_playback");

    const beforeDuplicate = state.lastSeenAt.toISOString();
    result = await send(signal(5, "playing", musicA, 5, "playing", ambientA));
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "duplicate sequences are ignored");
    [state] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert.equal(state.lastSeenAt.toISOString(), beforeDuplicate, "stale/duplicate signal has zero timestamp effect");
    const replacement = await beginMonitoringSession(activeId);
    assert.equal(replacement.generation, session.generation + 1);
    result = await send(signal(Number.MAX_SAFE_INTEGER, "playing", musicA, Number.MAX_SAFE_INTEGER, "playing", ambientA, session.sessionId, session.generation));
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "old generation rejected despite arbitrarily high sequence");
    result = await send(signal(99, "playing", musicA, 99, "playing", ambientA, randomUUID(), replacement.generation));
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "wrong session rejected");

    const newer = await beginMonitoringSession(activeId);
    result = await send(signal(Number.MAX_SAFE_INTEGER, "playing", musicA, Number.MAX_SAFE_INTEGER, "playing", ambientA));
    assert.deepEqual(result.accepted, { music: false, ambient: false }, "prior generation remains stale after reload/new session");
    result = await send(signal(1, "paused", musicB, 1, "idle", null, newer.sessionId, newer.generation));
    assert.deepEqual(result.accepted, { music: true, ambient: true });

    const invalidClaim = await postHeartbeat(activeCredential, signal(2, "playing", ambientA, 2, "idle", null, newer.sessionId, newer.generation));
    assert.equal(invalidClaim.status, 400, "an Ambient channel cannot be claimed by MUSIC");
    result = await send(signal(2, "playing", musicA, 2, "idle", null, newer.sessionId, newer.generation));
    assert.deepEqual(result.accepted, { music: true, ambient: true }, "rejected channel claim does not consume either sequence");
    const syntheticEvents = await v2Db.select({ id: deviceEvents.id }).from(deviceEvents).where(inArray(deviceEvents.deviceId, deviceIds));
    assert.equal(syntheticEvents.length, 0, "monitoring may write current state but not event/aggregate tables");
  } finally {
    if (deviceIds.length) await v2Db.delete(devices).where(inArray(devices.id, deviceIds));
    if (locationIds.length) await v2Db.delete(locations).where(inArray(locations.id, locationIds));
    if (organizationIds.length) await v2Db.delete(organizations).where(inArray(organizations.id, organizationIds));
    const leftovers = await v2Db.select({ id: deviceCurrentState.deviceId }).from(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, deviceIds));
    assert.equal(leftovers.length, 0, "synthetic current state must be cleaned by Device cascade");
    await v2Pool.end();
  }
}

main().then(() => console.info("PASS: synthetic real-route authentication, same-origin protection, dual-lane state/order, last_seen/last_playback semantics and reload-generation rejection; fixtures cleaned.")).catch((error) => { console.error(error); process.exitCode = 1; });
