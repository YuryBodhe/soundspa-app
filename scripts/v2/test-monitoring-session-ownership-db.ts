import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { devices, deviceCurrentState, locations, organizations } from "../../db/v2/schema";
import { authenticateDeviceCredential } from "../../db/v2/queries/devices";
import { acceptMonitoringSnapshot, beginMonitoringSession, MONITORING_LEASE_MS, releaseMonitoringSession } from "../../db/v2/services/monitoringSessions";

async function main() {
  const expectedDataDir = process.env.MONITORING_ISOLATED_DATA_DIR;
  assert(expectedDataDir?.includes("soundspa-monitoring-"), "An isolated temporary PostgreSQL data directory is required");
  const identity = await v2Db.execute(sql`SELECT current_database() AS database, current_setting('data_directory') AS data_dir`);
  assert.equal(identity.rows[0]?.database, "soundspa_v2");
  assert.equal(identity.rows[0]?.data_dir, expectedDataDir);

  const [organization] = await v2Db.insert(organizations).values({ name: "Isolated monitoring test" }).returning({ id: organizations.id });
  const [location] = await v2Db.insert(locations).values({ organizationId: organization.id, name: "Location", slug: `monitoring-${randomUUID()}`, timezone: "UTC" }).returning({ id: locations.id });
  const credential = randomUUID() + randomUUID();
  const [device] = await v2Db.insert(devices).values({
    locationId: location.id, label: "Test device",
    credentialHash: createHash("sha256").update(credential).digest("hex"),
  }).returning({ id: devices.id });
  try {
    assert.equal((await authenticateDeviceCredential(credential))?.deviceId, device.id);
    const claims = await Promise.all(Array.from({ length: 8 }, () => beginMonitoringSession(device.id)));
    const winners = claims.filter(c => c.status === "acquired");
    assert.equal(winners.length, 1, "only one simultaneous claim may win");
    const owner = winners[0]!;
    if (owner.status !== "acquired") throw new Error("No owner");
    assert.equal(claims.filter(c => c.status === "owner_active").length, 7);
    assert.equal((await beginMonitoringSession(device.id)).status, "owner_active", "healthy owner refuses takeover");
    const [before] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, device.id));
    assert.equal(before.musicSequence, 0, "claim is offline until heartbeat");

    const heartbeat = await acceptMonitoringSnapshot({
      deviceId: device.id, sessionId: owner.sessionId, generation: owner.generation,
      music: { sequence: 1, state: "playing", channelId: null },
      ambient: { sequence: 1, state: "idle", channelId: null },
    });
    assert.deepEqual(heartbeat.accepted, { music: true, ambient: true });
    assert.equal(await releaseMonitoringSession({ deviceId: device.id, ...owner }), true);
    const [released] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, device.id));
    assert.equal(released.musicSequence, null);
    assert.equal(released.musicPlaybackState, "playing", "historical state survives release");

    const next = await beginMonitoringSession(device.id);
    assert.equal(next.status, "acquired");
    if (next.status !== "acquired") throw new Error("Release did not permit claim");
    assert.equal(await releaseMonitoringSession({ deviceId: device.id, ...owner }), false, "delayed old release cannot revoke new owner");
    const [stillOwned] = await v2Db.select().from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, device.id));
    assert.equal(stillOwned.musicSessionId, next.sessionId);

    await v2Db.update(deviceCurrentState).set({ updatedAt: new Date(Date.now() - MONITORING_LEASE_MS - 1_000) }).where(eq(deviceCurrentState.deviceId, device.id));
    const afterCrash = await beginMonitoringSession(device.id);
    assert.equal(afterCrash.status, "acquired", "stale owner is replaceable");
    if (afterCrash.status !== "acquired") throw new Error("Stale claim refused");
    assert.equal(await releaseMonitoringSession({ deviceId: device.id, ...next }), false);
    assert.equal((await acceptMonitoringSnapshot({
      deviceId: device.id, sessionId: next.sessionId, generation: next.generation,
      music: { sequence: 2, state: "playing", channelId: null }, ambient: { sequence: 2, state: "playing", channelId: null },
    })).accepted.music, false, "old heartbeat cannot reclaim ownership");
    await v2Db.update(devices).set({ status: "revoked", revokedAt: new Date() }).where(eq(devices.id, device.id));
    assert.equal(await authenticateDeviceCredential(credential), null, "revoked device cannot acquire through the authenticated route");
    console.info("PASS: isolated concurrent claims, healthy refusal, heartbeat, release, stale takeover, delayed old signals, and revoked-device authentication");
  } finally {
    await v2Db.delete(devices).where(eq(devices.id, device.id));
    await v2Db.delete(locations).where(eq(locations.id, location.id));
    await v2Db.delete(organizations).where(eq(organizations.id, organization.id));
    await v2Pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
