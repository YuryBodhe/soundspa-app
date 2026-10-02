// Explicit staging verification for the Gate 4B.1 generation protocol.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { isCurrentMonitoringSignal, beginMonitoringSession } from "../../db/v2/services/monitoringSessions";
import { authenticateDeviceCredential } from "../../db/v2/queries/devices";
import { deviceCurrentState, devices, locations, organizations } from "../../db/v2/schema";

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize this isolated verification.");
  const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
  assert.equal(target.rows[0]?.database, "soundspa_v2");
  assert.equal(target.rows[0]?.user, "soundspa_v2");
  const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
  assert.equal(journal.rows[0]?.count, 10);

  const origin = process.env.V2_PUBLIC_ORIGIN;
  assert(origin, "V2_PUBLIC_ORIGIN must point at the isolated staging app for HTTP auth checks.");
  const normalizedOrigin = new URL(origin).origin;
  const suffix = randomUUID();
  const organizationIds: string[] = [];
  const locationIds: string[] = [];
  const deviceIds: string[] = [];
  const credentials = new Map<string, string>();

  async function createDevice(label: string, status: "active" | "revoked") {
    const credential = randomUUID() + randomUUID();
    const credentialHash = createHash("sha256").update(credential, "utf8").digest("hex");
    const [device] = await v2Db.insert(devices).values({
      locationId: locationIds[0], label, status, credentialHash,
      revokedAt: status === "revoked" ? new Date() : null,
    }).returning({ id: devices.id });
    deviceIds.push(device.id);
    credentials.set(label, credential);
    return device.id;
  }

  async function postSession(credential?: string) {
    return fetch(`${normalizedOrigin}/api/v2/monitoring/session`, {
      method: "POST",
      headers: {
        origin: normalizedOrigin,
        ...(credential ? { cookie: `soundspa_v2_device=${credential}` } : {}),
      },
      cache: "no-store",
    });
  }

  try {
    const [organization] = await v2Db.insert(organizations).values({ name: `monitoring-generation-${suffix}` }).returning({ id: organizations.id });
    organizationIds.push(organization.id);
    const [location] = await v2Db.insert(locations).values({
      organizationId: organization.id, name: "Monitoring generation verification",
      slug: `monitoring-generation-${suffix}`, timezone: "UTC",
    }).returning({ id: locations.id });
    locationIds.push(location.id);

    const activeId = await createDevice("synthetic-active", "active");
    const revokedId = await createDevice("synthetic-revoked", "revoked");
    const deletedId = await createDevice("synthetic-deleted", "active");
    assert.equal((await authenticateDeviceCredential(credentials.get("synthetic-active")!))?.deviceId, activeId);
    assert.equal(await authenticateDeviceCredential(""), null, "missing credential must not authenticate");
    assert.equal(await authenticateDeviceCredential(randomUUID()), null, "invalid credential must not authenticate");
    assert.equal(await authenticateDeviceCredential(credentials.get("synthetic-revoked")!), null, "revoked Device must not authenticate");

    assert.equal((await postSession()).status, 401, "missing credential route request must be rejected");
    assert.equal((await postSession(randomUUID())).status, 401, "invalid credential route request must be rejected");
    assert.equal((await postSession(credentials.get("synthetic-revoked"))).status, 401, "revoked Device route request must be rejected");

    const firstResponse = await postSession(credentials.get("synthetic-active"));
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as { sessionId: string; generation: number };
    assert.match(first.sessionId, /^[0-9a-f-]{36}$/i);
    assert.equal(first.generation, 1);

    const second = await beginMonitoringSession(activeId);
    assert.equal(second.generation, first.generation + 1);
    assert.notEqual(second.sessionId, first.sessionId);

    const concurrent = await Promise.all(Array.from({ length: 6 }, () => beginMonitoringSession(activeId)));
    const concurrentGenerations = concurrent.map((item) => item.generation).sort((a, b) => a - b);
    assert.equal(new Set(concurrentGenerations).size, concurrentGenerations.length, "concurrent session starts must get unique generations");
    assert.deepEqual(concurrentGenerations, Array.from({ length: 6 }, (_, index) => second.generation + index + 1));
    const newest = concurrent.reduce((a, b) => a.generation > b.generation ? a : b);
    const [current] = await v2Db.select({
      generation: deviceCurrentState.monitoringGeneration,
      musicSessionId: deviceCurrentState.musicSessionId,
      ambientSessionId: deviceCurrentState.ambientSessionId,
      musicSequence: deviceCurrentState.musicSequence,
      ambientSequence: deviceCurrentState.ambientSequence,
    }).from(deviceCurrentState).where(eq(deviceCurrentState.deviceId, activeId));
    assert.deepEqual(current, {
      generation: newest.generation,
      musicSessionId: newest.sessionId,
      ambientSessionId: newest.sessionId,
      musicSequence: 0,
      ambientSequence: 0,
    });

    // Old session with arbitrarily large sequence cannot displace the new generation.
    await v2Db.transaction(async (tx) => {
      assert.equal(await isCurrentMonitoringSignal(tx, {
        deviceId: activeId, generation: first.generation, sessionId: first.sessionId,
        lane: "music", sequence: Number.MAX_SAFE_INTEGER,
      }), false);
      assert.equal(await isCurrentMonitoringSignal(tx, {
        deviceId: activeId, generation: newest.generation, sessionId: first.sessionId,
        lane: "music", sequence: 1,
      }), false, "wrong session for current generation must be rejected");
      assert.equal(await isCurrentMonitoringSignal(tx, {
        deviceId: activeId, generation: newest.generation, sessionId: newest.sessionId,
        lane: "music", sequence: 1,
      }), true);
      await tx.update(deviceCurrentState).set({ musicSequence: 1 }).where(eq(deviceCurrentState.deviceId, activeId));
      assert.equal(await isCurrentMonitoringSignal(tx, {
        deviceId: activeId, generation: newest.generation, sessionId: newest.sessionId,
        lane: "music", sequence: 1,
      }), false, "duplicate sequence must be ignored");
      assert.equal(await isCurrentMonitoringSignal(tx, {
        deviceId: activeId, generation: newest.generation, sessionId: newest.sessionId,
        lane: "music", sequence: 0,
      }), false, "older sequence must be ignored");
      assert.equal(await isCurrentMonitoringSignal(tx, {
        deviceId: activeId, generation: newest.generation, sessionId: newest.sessionId,
        lane: "ambient", sequence: 1,
      }), true, "lane sequences must remain independent");
      await tx.update(deviceCurrentState).set({ ambientSequence: 1 }).where(eq(deviceCurrentState.deviceId, activeId));
    });

    await v2Db.delete(devices).where(eq(devices.id, deletedId));
    assert.equal(await authenticateDeviceCredential(credentials.get("synthetic-deleted")!), null, "deleted Device must not authenticate");
    assert.equal((await postSession(credentials.get("synthetic-deleted"))).status, 401, "deleted Device route request must be rejected");
    console.info("PASS: monitoring session generation, atomic concurrency, stale-session rejection, per-lane sequence ordering, and synthetic Device auth. No real credentials used; synthetic fixture cleanup follows.");
  } finally {
    for (const id of deviceIds) await v2Db.delete(devices).where(eq(devices.id, id));
    for (const id of locationIds) await v2Db.delete(locations).where(eq(locations.id, id));
    for (const id of organizationIds) await v2Db.delete(organizations).where(eq(organizations.id, id));
    const leftovers = await v2Db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationIds[0] ?? "00000000-0000-0000-0000-000000000000"));
    assert.equal(leftovers.length, 0, "synthetic monitoring verification Organization must be removed");
    await v2Pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
