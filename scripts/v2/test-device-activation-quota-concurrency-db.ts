import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";

const TEST_URL = process.env.V2_DEVICE_ACTIVATION_QUOTA_TEST_DATABASE_URL;
assert(TEST_URL, "Set V2_DEVICE_ACTIVATION_QUOTA_TEST_DATABASE_URL to a disposable local PostgreSQL 16 database.");
assert.equal(process.env.V2_DEVICE_ACTIVATION_QUOTA_TEST_CONFIRM_DISPOSABLE_DB, "yes",
  "This test creates an immutable Organization Trial slot; point it at a disposable database that will be destroyed after the run.");
const parsed = new URL(TEST_URL);
assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Activation quota integration tests require loopback PostgreSQL.");
assert.equal(decodeURIComponent(parsed.pathname), "/soundspa_v2");
assert(!new Set(["postgres", "root"]).has(decodeURIComponent(parsed.username)), "Use a dedicated non-superuser test role.");
process.env.V2_DATABASE_URL = TEST_URL;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const [{ v2Db, v2Pool }, schema, provisioning, administration] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/deviceProvisioning"),
    import("../../db/v2/services/deviceAdministration"),
  ]);

  const suffix = randomUUID();
  const deviceIds: string[] = [];
  let organizationId: string | undefined;
  let locationId: string | undefined;
  try {
    const version = await v2Pool.query<{ server_version_num: string }>("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10_000), 16, "integration database must be PostgreSQL 16");
    const [basic] = await v2Db.select({ id: schema.commercialProducts.id, isActive: schema.commercialProducts.isActive })
      .from(schema.commercialProducts).where(eq(schema.commercialProducts.code, "soundspa")).limit(1);
    assert(basic?.isActive, "Basic catalog product must already be active; test does not modify global catalog");

    const nowResult = await v2Pool.query<{ now: Date }>("SELECT statement_timestamp() AS now");
    const now = nowResult.rows[0]!.now;
    const startsAt = new Date(now.getTime() - 60_000);
    const endsAt = new Date(now.getTime() + 86_400_000);
    const futureToken = () => randomBytes(32).toString("base64url");

    const [organization] = await v2Db.insert(schema.organizations).values({ name: `Activation quota test ${suffix}` }).returning({ id: schema.organizations.id });
    organizationId = organization!.id;
    const [location] = await v2Db.insert(schema.locations).values({
      organizationId, name: "Concurrent trial", slug: `activation-quota-${suffix.slice(0, 8)}`, timezone: "UTC",
    }).returning({ id: schema.locations.id });
    locationId = location!.id;
    const [trial] = await v2Db.insert(schema.organizationCoreTrials).values({
      organizationId, productId: basic.id, status: "active", startsAt, endsAt,
      origin: "first_location_creation", createdAt: startsAt, updatedAt: startsAt,
    }).returning({ id: schema.organizationCoreTrials.id });
    const trialId = trial!.id;
    await v2Db.insert(schema.organizationCoreTrialLocations).values({
      organizationTrialId: trialId, organizationId, locationId, slotNumber: 1,
      source: "first_location_creation", allocatedAt: startsAt,
    });

    const preexisting = await v2Db.insert(schema.devices).values(Array.from({ length: 4 }, (_, index) => ({
      locationId: locationId!, label: `Existing ${index + 1}`, credentialHash: `fixture-${suffix}-${index}`,
    }))).returning({ id: schema.devices.id });
    deviceIds.push(...preexisting.map((device) => device.id));
    await v2Db.insert(schema.deviceProductAssignments).values(preexisting.map((device) => ({
      deviceId: device.id, productId: basic!.id, source: "operator" as const,
    })));

    const candidates = await Promise.all([0, 1].map(async (index) => {
      const token = futureToken();
      const [device] = await v2Db.insert(schema.devices).values({
        locationId: locationId!, label: `Pending ${index + 1}`, credentialHash: null,
      }).returning({ id: schema.devices.id });
      deviceIds.push(device!.id);
      await v2Db.insert(schema.deviceActivationTokens).values({
        deviceId: device!.id, tokenHash: hash(token), expiresAt: new Date(now.getTime() + 3_600_000),
      });
      return { deviceId: device!.id, token };
    }));

    const outcomes = await Promise.allSettled(candidates.map(({ token }) => provisioning.activateDevice(token)));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1,
      "of two concurrent activations competing for the fifth Trial slot, exactly one succeeds");
    const winningIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    const winner = candidates[winningIndex]!;
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    assert.equal(rejected.length, 1);
    assert(rejected[0]!.reason instanceof provisioning.DeviceProvisioningError);
    assert.equal((rejected[0]!.reason as InstanceType<typeof provisioning.DeviceProvisioningError>).code, "basic_device_limit_reached");

    const activeAssignments = await v2Db.select({ deviceId: schema.deviceProductAssignments.deviceId })
      .from(schema.deviceProductAssignments)
      .innerJoin(schema.devices, eq(schema.devices.id, schema.deviceProductAssignments.deviceId))
      .where(and(eq(schema.devices.locationId, locationId), eq(schema.deviceProductAssignments.productId, basic.id),
        isNull(schema.deviceProductAssignments.revokedAt), isNull(schema.devices.revokedAt)));
    assert.equal(activeAssignments.length, 5, "serialized activation never creates a sixth active Basic Trial assignment");
    await assert.rejects(provisioning.activateDevice(winner.token),
      (error: unknown) => error instanceof provisioning.DeviceProvisioningError && error.code === "activation_invalid");
    const winnerAssignmentCount = await v2Db.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
      .where(and(eq(schema.deviceProductAssignments.deviceId, winner.deviceId), eq(schema.deviceProductAssignments.productId, basic.id)));
    assert.equal(winnerAssignmentCount.length, 1, "replaying a consumed activation token does not duplicate its assignment");

    const unactivated = await v2Db.select({ deviceId: schema.devices.id, credentialHash: schema.devices.credentialHash })
      .from(schema.devices).where(and(inArray(schema.devices.id, candidates.map((candidate) => candidate.deviceId)), isNull(schema.devices.credentialHash)));
    assert.equal(unactivated.length, 1, "quota rejection leaves the losing Device retryable and without a credential");
    const loser = candidates.find((candidate) => candidate.deviceId === unactivated[0]!.deviceId)!;
    const loserToken = await v2Db.select({ usedAt: schema.deviceActivationTokens.usedAt }).from(schema.deviceActivationTokens)
      .where(eq(schema.deviceActivationTokens.tokenHash, hash(loser.token))).limit(1);
    assert.equal(loserToken[0]?.usedAt, null, "quota rejection does not consume the pending activation token");

    // Free one fixture slot and retry the exact losing token. It must now be usable.
    await v2Db.update(schema.deviceProductAssignments).set({
      revokedAt: new Date(), revokedBy: "integration-test", revokeReason: "Free a disposable test slot for retry assertion",
    }).where(eq(schema.deviceProductAssignments.deviceId, preexisting[0]!.id));
    await provisioning.activateDevice(loser.token);
    const retriedDevice = await v2Db.select({ credentialHash: schema.devices.credentialHash })
      .from(schema.devices).where(eq(schema.devices.id, loser.deviceId)).limit(1);
    assert(retriedDevice[0]?.credentialHash, "same activation token can be retried after quota becomes available");
    const retriedAssignment = await v2Db.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
      .where(and(eq(schema.deviceProductAssignments.deviceId, loser.deviceId), eq(schema.deviceProductAssignments.productId, basic.id),
        isNull(schema.deviceProductAssignments.revokedAt)));
    assert.equal(retriedAssignment.length, 1);

    // Reset rotates credentials/tokens but retains the Device identity and assignment slot.
    const beforeReset = await v2Db.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
      .where(and(eq(schema.deviceProductAssignments.deviceId, winner.deviceId), eq(schema.deviceProductAssignments.productId, basic.id)));
    assert.equal(beforeReset.length, 1);
    const reset = await administration.resetActivatedDeviceAccess(winner.deviceId);
    const afterReset = await v2Db.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
      .where(and(eq(schema.deviceProductAssignments.deviceId, winner.deviceId), eq(schema.deviceProductAssignments.productId, basic.id)));
    assert.deepEqual(afterReset.map((row) => row.id), beforeReset.map((row) => row.id), "credential reset preserves the same assignment history");
    await provisioning.activateDevice(reset.activationToken);
    const afterReactivation = await v2Db.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
      .where(and(eq(schema.deviceProductAssignments.deviceId, winner.deviceId), eq(schema.deviceProductAssignments.productId, basic.id)));
    assert.deepEqual(afterReactivation.map((row) => row.id), beforeReset.map((row) => row.id), "reactivation does not duplicate the Device assignment");

    // Pending links alone do not count: they had no assignment before activation.
    assert.equal((await v2Db.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
      .where(and(inArray(schema.deviceProductAssignments.deviceId, candidates.map((candidate) => candidate.deviceId)),
        eq(schema.deviceProductAssignments.productId, basic.id)))).length, 2);

    console.info("V2 Device activation quota PostgreSQL 16 integration PASS: concurrent activation is serialized at five, losing token and credential remain retryable, credential reset preserves assignment identity, and reactivation does not duplicate assignments.");
  } finally {
    if (locationId) {
      // Lifecycle snapshots intentionally have no FK and are removed only for this disposable fixture.
      await v2Pool.query("DELETE FROM monitoring_lifecycle_events WHERE location_id = $1", [locationId]);
      await v2Pool.query("DELETE FROM device_current_browser_operations WHERE location_id = $1", [locationId]);
      await v2Db.delete(schema.deviceProductAssignments).where(inArray(schema.deviceProductAssignments.deviceId, deviceIds));
      await v2Db.delete(schema.deviceActivationTokens).where(inArray(schema.deviceActivationTokens.deviceId, deviceIds));
      await v2Db.delete(schema.devices).where(inArray(schema.devices.id, deviceIds));
      // The trial slot has an immutable append-only trigger. Never bypass it for
      // test cleanup; destroy the disposable database after this test instead.
    }
    await v2Pool.end();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
