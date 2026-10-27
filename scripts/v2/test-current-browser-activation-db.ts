import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const testUrl = process.env.V2_ONBOARDING_TEST_DATABASE_URL;
assert(testUrl, "Set V2_ONBOARDING_TEST_DATABASE_URL to an isolated local V2 test database.");
const parsedUrl = new URL(testUrl);
assert(["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname), "Activation DB tests are restricted to a local loopback database.");
assert.equal(decodeURIComponent(parsedUrl.pathname), "/soundspa_v2", "The test database must use the V2 database name.");
process.env.V2_DATABASE_URL = testUrl;
process.env.V2_DEVICE_ACTIVATION_SECRET = randomBytes(48).toString("base64url");

async function main() {
const [{ v2Db }, schema, provisioning, { authenticateDeviceCredential }, { eq, inArray, sql }] = await Promise.all([
  import("../../db/v2/client"),
  import("../../db/v2/schema"),
  import("../../db/v2/services/deviceProvisioning"),
  import("../../db/v2/queries/devices"),
  import("drizzle-orm"),
]);
const { CustomerDeviceAuthorizationError } = await import("../../lib/v2/customerDeviceAuthorization");
const { currentBrowserOperationHash } = await import("../../lib/v2/currentBrowserDeviceCredential");
const marker = randomUUID();
const organizationIds: string[] = [];
const locationIds: string[] = [];
const userIds: string[] = [];
const deviceIds: string[] = [];
const triggerSuffix = randomUUID().replaceAll("-", "");
const triggerName = `test_fail_current_browser_${triggerSuffix}`;
const functionName = `${triggerName}_fn`;
let triggerInstalled = false;

function opId() { return randomUUID(); }
async function countDevices(locationId: string) {
  return (await v2Db.select({ id: schema.devices.id }).from(schema.devices).where(eq(schema.devices.locationId, locationId))).length;
}
async function create(input: { userId: string; locationId: string; operationId: string; name?: string }) {
  const result = await provisioning.createAndActivateCustomerDevice({
    authenticatedUserId: input.userId, locationId: input.locationId, operationId: input.operationId, name: input.name ?? "Browser test Device",
  });
  deviceIds.push(result.device.id);
  return result;
}

try {
  const [org] = await v2Db.insert(schema.organizations).values({ name: `Current browser activation ${marker}` }).returning();
  organizationIds.push(org.id);
  const [location] = await v2Db.insert(schema.locations).values({ organizationId: org.id, name: "Authorized Location", slug: `activation-${marker}`, timezone: "UTC" }).returning();
  locationIds.push(location.id);
  const [foreignOrg] = await v2Db.insert(schema.organizations).values({ name: `Foreign activation ${marker}` }).returning();
  organizationIds.push(foreignOrg.id);
  const [foreignLocation] = await v2Db.insert(schema.locations).values({ organizationId: foreignOrg.id, name: "Foreign Location", slug: `activation-foreign-${marker}`, timezone: "UTC" }).returning();
  locationIds.push(foreignLocation.id);
  const [user] = await v2Db.insert(schema.users).values({ email: `activation-${marker}@example.invalid`, emailVerifiedAt: new Date() }).returning();
  userIds.push(user.id);
  await v2Db.insert(schema.organizationMembers).values({ organizationId: org.id, userId: user.id, role: "owner" });

  const sequentialOperation = opId();
  const first = await create({ userId: user.id, locationId: location.id, operationId: sequentialOperation });
  const firstAuth = await authenticateDeviceCredential(first.credential);
  assert.equal(firstAuth?.deviceId, first.device.id, "the issued cookie credential authenticates the created Device");
  const repeated = await create({ userId: user.id, locationId: location.id, operationId: sequentialOperation });
  assert.equal(repeated.device.id, first.device.id, "sequential retry returns the same Device identity");
  assert.equal(repeated.credential, first.credential, "retry recovers the same credential without storing it in plaintext");
  assert.equal(await countDevices(location.id), 1);
  assert.equal((await v2Db.select().from(schema.monitoringLifecycleEvents).where(eq(schema.monitoringLifecycleEvents.deviceId, first.device.id))).length, 2, "retry must not duplicate lifecycle events");

  const concurrentOperation = opId();
  const concurrent = await Promise.all([
    create({ userId: user.id, locationId: location.id, operationId: concurrentOperation }),
    create({ userId: user.id, locationId: location.id, operationId: concurrentOperation }),
  ]);
  assert.equal(concurrent[0].device.id, concurrent[1].device.id, "concurrent requests converge on the unique operation row");
  assert.equal(concurrent[0].credential, concurrent[1].credential);
  assert.equal(await countDevices(location.id), 2);
  assert.equal((await v2Db.select().from(schema.monitoringLifecycleEvents).where(eq(schema.monitoringLifecycleEvents.deviceId, concurrent[0].device.id))).length, 2);

  // Simulate a successful server commit whose response/cookie was lost, then retry.
  const lostResponseOperation = opId();
  const lost = await create({ userId: user.id, locationId: location.id, operationId: lostResponseOperation });
  const recovered = await create({ userId: user.id, locationId: location.id, operationId: lostResponseOperation });
  assert.equal(recovered.device.id, lost.device.id);
  assert.equal(recovered.credential, lost.credential);
  assert.equal(await countDevices(location.id), 3);

  // Exercise expiry through the original operation identifier without retaining it in the DB fixture output.
  // The operation value is kept only in this test process and is never logged.
  const expiredOperation = opId();
  await create({ userId: user.id, locationId: location.id, operationId: expiredOperation });
  const expiredOperationHash = currentBrowserOperationHash(expiredOperation);
  const [expiredOperationRow] = await v2Db.select({ createdAt: schema.deviceCurrentBrowserOperations.createdAt })
    .from(schema.deviceCurrentBrowserOperations).where(eq(schema.deviceCurrentBrowserOperations.operationHash, expiredOperationHash));
  assert(expiredOperationRow);
  await v2Db.update(schema.deviceCurrentBrowserOperations).set({ expiresAt: new Date(expiredOperationRow.createdAt.getTime() + 1) })
    .where(eq(schema.deviceCurrentBrowserOperations.operationHash, expiredOperationHash));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(
    provisioning.createAndActivateCustomerDevice({ authenticatedUserId: user.id, locationId: location.id, operationId: expiredOperation, name: "Browser test Device" }),
    (error: unknown) => error instanceof provisioning.DeviceProvisioningError && error.code === "operation_expired",
  );
  assert.equal(await countDevices(location.id), 4, "expired retry must not create a replacement Device");

  const deletedOperation = opId();
  const deleted = await create({ userId: user.id, locationId: location.id, operationId: deletedOperation });
  await v2Db.delete(schema.devices).where(eq(schema.devices.id, deleted.device.id));
  await assert.rejects(
    provisioning.createAndActivateCustomerDevice({ authenticatedUserId: user.id, locationId: location.id, operationId: deletedOperation, name: "Browser test Device" }),
    (error: unknown) => error instanceof provisioning.DeviceProvisioningError && error.code === "operation_conflict",
  );
  assert.equal(await countDevices(location.id), 4, "a deleted Device leaves an idempotency tombstone and cannot be recreated by replay");

  const revokedOperation = opId();
  const revoked = await create({ userId: user.id, locationId: location.id, operationId: revokedOperation });
  await v2Db.update(schema.devices).set({ status: "revoked", revokedAt: new Date() }).where(eq(schema.devices.id, revoked.device.id));
  await assert.rejects(
    provisioning.createAndActivateCustomerDevice({ authenticatedUserId: user.id, locationId: location.id, operationId: revokedOperation, name: "Browser test Device" }),
    (error: unknown) => error instanceof provisioning.DeviceProvisioningError && error.code === "operation_conflict",
  );

  const beforeUnauthorized = await countDevices(foreignLocation.id);
  await assert.rejects(
    provisioning.createAndActivateCustomerDevice({ authenticatedUserId: user.id, locationId: foreignLocation.id, operationId: opId(), name: "Unauthorized" }),
    (error: unknown) => error instanceof CustomerDeviceAuthorizationError,
  );
  assert.equal(await countDevices(foreignLocation.id), beforeUnauthorized, "foreign Location authorization cannot create a Device");

  const rollbackOperation = opId();
  await v2Db.execute(sql.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'device_activated' THEN RAISE EXCEPTION 'forced test lifecycle failure'; END IF; RETURN NEW; END $$`));
  await v2Db.execute(sql.raw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON monitoring_lifecycle_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`));
  triggerInstalled = true;
  const beforeRollbackCount = await countDevices(location.id);
  await assert.rejects(
    provisioning.createAndActivateCustomerDevice({ authenticatedUserId: user.id, locationId: location.id, operationId: rollbackOperation, name: "Rollback Device" }),
    (error: unknown) => error instanceof Error && error.message.includes("Failed query"),
  );
  assert.equal(await countDevices(location.id), beforeRollbackCount, "failed lifecycle event rolls back Device insertion");
  assert.equal((await v2Db.select({ operationHash: schema.deviceCurrentBrowserOperations.operationHash })
    .from(schema.deviceCurrentBrowserOperations).where(eq(schema.deviceCurrentBrowserOperations.operationHash, currentBrowserOperationHash(rollbackOperation)))).length, 0,
  "failed activation must roll back its operation tombstone too");
  assert.equal((await v2Db.select().from(schema.monitoringLifecycleEvents).where(eq(schema.monitoringLifecycleEvents.organizationId, org.id))).length, 12, "failed lifecycle event leaves no partial event");
  await v2Db.execute(sql.raw(`DROP TRIGGER ${triggerName} ON monitoring_lifecycle_events`));
  await v2Db.execute(sql.raw(`DROP FUNCTION ${functionName}()`));
  triggerInstalled = false;

  const additional = await create({ userId: user.id, locationId: location.id, operationId: opId(), name: "Intentional additional Device" });
  assert.notEqual(additional.device.id, first.device.id, "a fresh operation intentionally creates an additional Device");
  assert.equal(await countDevices(location.id), beforeRollbackCount + 1);
  console.info("V2 current-browser activation DB PASS: sequential/concurrent retries, lost-response credential recovery, bounded expiry, deleted-operation tombstone, revoked Device rejection, exact-Location authorization, transaction rollback, and fresh-operation additional Device.");
} finally {
  if (triggerInstalled) {
    await v2Db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON monitoring_lifecycle_events`));
    await v2Db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
  }
  if (deviceIds.length) await v2Db.delete(schema.devices).where(inArray(schema.devices.id, [...new Set(deviceIds)]));
  if (userIds.length) await v2Db.delete(schema.deviceCurrentBrowserOperations).where(eq(schema.deviceCurrentBrowserOperations.authenticatedUserId, userIds[0]));
  if (organizationIds.length) await v2Db.delete(schema.monitoringLifecycleEvents).where(inArray(schema.monitoringLifecycleEvents.organizationId, organizationIds));
  if (locationIds.length) await v2Db.delete(schema.locations).where(inArray(schema.locations.id, locationIds));
  if (organizationIds.length && userIds.length) await v2Db.delete(schema.organizationMembers).where(eq(schema.organizationMembers.userId, userIds[0]));
  if (organizationIds.length) await v2Db.delete(schema.organizations).where(inArray(schema.organizations.id, organizationIds));
  if (userIds.length) await v2Db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await v2Db.$client.end();
}
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
