import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { v2Db, v2Pool } from "../../db/v2/client";
import { deviceCurrentState, deviceEvents, devices, hourlyErrorAggregates, locations, monitoringLifecycleEvents, organizations } from "../../db/v2/schema";
import { recordCustomerCatalogFailure } from "../../db/v2/services/monitoringObservability";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function main() {
  assert(process.argv.includes("--staging"), "Pass --staging to authorize synthetic-only observability verification.");
  const origin = process.env.V2_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
  const publicOrigin = new URL(process.env.V2_PUBLIC_ORIGIN || origin).origin;
  const target = await v2Db.execute(sql`SELECT current_database() AS database, current_user AS "user"`);
  assert.equal(target.rows[0]?.database, "soundspa_v2");
  assert.equal(target.rows[0]?.user, "soundspa_v2");
  const journal = await v2Db.execute(sql`SELECT count(*)::int AS count FROM drizzle_v2.__drizzle_migrations`);
  assert.equal(journal.rows[0]?.count, 10);

  const suffix = randomUUID();
  const marker = `Gate 4D ${suffix}`;
  const credentials = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  let organizationId: string | null = null;
  let locationId: string | null = null;
  const deviceIds: string[] = [];
  try {
    await v2Db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name: `${marker} organization` }).returning({ id: organizations.id });
      organizationId = organization.id;
      const [location] = await tx.insert(locations).values({ organizationId, name: `${marker} location`, slug: `gate-4d-${suffix}`, timezone: "UTC" }).returning({ id: locations.id });
      locationId = location.id;
      for (const credential of credentials) {
        const [device] = await tx.insert(devices).values({ locationId, label: `${marker} device`, credentialHash: sha256(credential) }).returning({ id: devices.id });
        deviceIds.push(device.id);
      }
    });

    const cookie = (credential: string) => `soundspa_v2_device=${credential}`;
    const send = (body: unknown, credential?: string, requestOrigin = publicOrigin) => fetch(`${origin}/api/v2/monitoring/error`, {
      method: "POST",
      headers: { Origin: requestOrigin, "Content-Type": "application/json", ...(credential ? { Cookie: cookie(credential) } : {}) },
      body: JSON.stringify(body),
    });
    assert.equal((await send({ lane: "music" })).status, 401, "unauthenticated report must be rejected");
    assert.equal((await send({ lane: "music" }, credentials[0], "https://untrusted.invalid")).status, 403, "cross-origin report must be rejected");
    assert.equal((await send({ lane: "music", errorCode: "UNTRUSTED_CODE" }, credentials[0])).status, 400, "client error-code override must be rejected");
    assert.equal((await send({ lane: "music", category: "AUTH" }, credentials[0])).status, 400, "client category override must be rejected");
    assert.equal((await send({ lane: "music", deviceId: deviceIds[1] }, credentials[0])).status, 400, "client Device-ID spoof must be rejected");
    assert.equal((await send({ lane: "not-a-lane" }, credentials[0])).status, 400, "unknown error kind must be rejected");
    assert.equal((await fetch(`${origin}/api/v2/monitoring/error`, { method: "POST", headers: { Origin: publicOrigin, "Content-Type": "application/json", Cookie: cookie(credentials[0]) }, body: `{"lane":"music","padding":"${"x".repeat(600)}"}` })).status, 413, "oversized bodies are rejected by the bounded request reader");

    assert.equal((await send({ lane: "music" }, credentials[0])).status, 200);
    assert.equal((await send({ lane: "music" }, credentials[0])).status, 200);
    const firstRows = await v2Db.select().from(hourlyErrorAggregates).where(and(eq(hourlyErrorAggregates.deviceId, deviceIds[0]), eq(hourlyErrorAggregates.errorCode, "MUSIC_PLAYBACK_FAILED")));
    assert.equal(firstRows.length, 1, "same device/code/hour must coalesce into one row");
    assert.equal(firstRows[0].category, "PLAYBACK");
    assert.equal(firstRows[0].eventCount, 2);
    assert(firstRows[0].firstSeenAt <= firstRows[0].lastSeenAt);
    assert.equal(firstRows[0].bucketStart.getUTCMinutes(), 0, "bucket starts on an exact UTC hour");
    assert.equal(firstRows[0].bucketStart.getUTCSeconds(), 0);

    assert.equal((await send({ lane: "music" }, credentials[1])).status, 200);
    const secondDeviceRows = await v2Db.select().from(hourlyErrorAggregates).where(and(eq(hourlyErrorAggregates.deviceId, deviceIds[1]), eq(hourlyErrorAggregates.errorCode, "MUSIC_PLAYBACK_FAILED")));
    assert.equal(secondDeviceRows.length, 1, "a second Device has an independent aggregate");
    assert.equal(secondDeviceRows[0].eventCount, 1);

    await recordCustomerCatalogFailure(deviceIds[0]);
    const catalogRows = await v2Db.select().from(hourlyErrorAggregates).where(and(eq(hourlyErrorAggregates.deviceId, deviceIds[0]), eq(hourlyErrorAggregates.errorCode, "CUSTOMER_CATALOG_FAILED")));
    assert.equal(catalogRows.length, 1);
    assert.equal(catalogRows[0].category, "CATALOG_CONFIG");

    const bucketRows = await v2Db.execute(sql`SELECT bucket_start FROM hourly_error_aggregates WHERE device_id = ${deviceIds[0]}::uuid AND category = 'PLAYBACK' AND error_code = 'MUSIC_PLAYBACK_FAILED'`);
    const currentBucket = bucketRows.rows[0]?.bucket_start;
    assert(currentBucket instanceof Date);
    const nextUtcHour = new Date(currentBucket.getTime() + 60 * 60 * 1_000);
    await v2Db.insert(hourlyErrorAggregates).values({ bucketStart: nextUtcHour, category: "PLAYBACK", errorCode: "MUSIC_PLAYBACK_FAILED", deviceId: deviceIds[0], eventCount: 1 });
    const distinctBuckets = await v2Db.select({ bucketStart: hourlyErrorAggregates.bucketStart }).from(hourlyErrorAggregates).where(and(eq(hourlyErrorAggregates.deviceId, deviceIds[0]), eq(hourlyErrorAggregates.category, "PLAYBACK"), eq(hourlyErrorAggregates.errorCode, "MUSIC_PLAYBACK_FAILED")));
    assert.equal(distinctBuckets.length, 2, "the same scoped error in another UTC bucket is a separate aggregate");

    const rejectedDeviceRows = await v2Db.select().from(hourlyErrorAggregates).where(and(inArray(hourlyErrorAggregates.deviceId, deviceIds), sql`${hourlyErrorAggregates.errorCode} NOT IN ('MUSIC_PLAYBACK_FAILED','AMBIENT_PLAYBACK_FAILED','CUSTOMER_CATALOG_FAILED')`));
    assert.equal(rejectedDeviceRows.length, 0, "rejected arbitrary payloads must not persist");
    assert.equal((await v2Db.select().from(monitoringLifecycleEvents).where(and(inArray(monitoringLifecycleEvents.deviceId, deviceIds), sql`${monitoringLifecycleEvents.organizationName} LIKE ${marker + "%"}`))).length, 0, "error reporting must not create lifecycle events");
    const technicalPlayer = readFileSync("app/v2/V2Player.tsx", "utf8");
    const previewRoute = readFileSync("app/admin/ui/locations/[locationId]/player-preview/page.tsx", "utf8");
    const technicalPage = readFileSync("app/v2/page.tsx", "utf8");
    assert.match(technicalPlayer, /if \(!monitoringEnabled \|\| engineChannelIdRef\.current !== activeChannelId\) return/);
    assert.doesNotMatch(previewRoute, /monitoringEnabled/);
    assert.doesNotMatch(technicalPage, /monitoringEnabled/);
    console.info("Gate 4D error aggregation PASS: Device-authenticated allowlisted lane reports, strict payload rejection, same-hour upsert, Device isolation, UTC-bucket separation, catalog code mapping, and no Preview or technical-player reporting.");
  } finally {
    if (deviceIds.length) {
      await v2Db.delete(hourlyErrorAggregates).where(inArray(hourlyErrorAggregates.deviceId, deviceIds));
      await v2Db.delete(monitoringLifecycleEvents).where(inArray(monitoringLifecycleEvents.deviceId, deviceIds));
      await v2Db.delete(deviceCurrentState).where(inArray(deviceCurrentState.deviceId, deviceIds));
      await v2Db.delete(deviceEvents).where(inArray(deviceEvents.deviceId, deviceIds));
      await v2Db.delete(devices).where(inArray(devices.id, deviceIds));
    }
    if (locationId) await v2Db.delete(locations).where(eq(locations.id, locationId));
    if (organizationId) await v2Db.delete(organizations).where(eq(organizations.id, organizationId));
    const leftovers = deviceIds.length ? await v2Db.select({ count: sql<number>`count(*)::int` }).from(hourlyErrorAggregates).where(inArray(hourlyErrorAggregates.deviceId, deviceIds)) : [{ count: 0 }];
    assert.equal(leftovers[0].count, 0, "all synthetic error aggregates must be cleaned exactly");
    await v2Pool.end();
  }
}

main().catch((error) => {
  console.error(`Gate 4D observability verification failed (${error instanceof Error ? error.name : typeof error})`);
  process.exitCode = 1;
});
