import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

class RollbackFixture extends Error {}
const TEST_URL = process.env.V2_DEVICE_PRODUCT_ASSIGNMENTS_TEST_DATABASE_URL;
assert(TEST_URL, "Set V2_DEVICE_PRODUCT_ASSIGNMENTS_TEST_DATABASE_URL to a disposable local PostgreSQL 16 database.");
const parsed = new URL(TEST_URL);
assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Device Product integration tests require loopback PostgreSQL.");
assert.equal(decodeURIComponent(parsed.pathname), "/soundspa_v2");
assert(!new Set(["postgres", "root"]).has(decodeURIComponent(parsed.username)), "Use a dedicated non-superuser test role.");
process.env.V2_DATABASE_URL = TEST_URL;

async function main() {
  const [{ v2Db, v2Pool }, schema, { backfillActivatedBasicDeviceAssignmentsInTransaction }, policy] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/deviceProductAssignments"),
    import("../../db/v2/services/deviceProductPolicy"),
  ]);

  try {
    const version = await v2Pool.query<{ server_version_num: string }>("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10_000), 16, "integration database must be PostgreSQL 16");
    const migrationObjects = await v2Pool.query<{ migration_table: string | null }>(
      "SELECT to_regclass('drizzle_v2.__drizzle_migrations')::text AS migration_table",
    );
    assert.equal(migrationObjects.rows[0]?.migration_table, "drizzle_v2.__drizzle_migrations", "V2 migration ledger must exist");
    const schemaObjects = await v2Pool.query<{ name: string; kind: string }>(`
      SELECT c.conname AS name, 'constraint' AS kind FROM pg_constraint c
      WHERE c.conrelid = 'public.device_product_assignments'::regclass
      UNION ALL
      SELECT i.relname AS name, 'index' AS kind FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      WHERE ix.indrelid = 'public.device_product_assignments'::regclass
    `);
    const objectNames = new Set(schemaObjects.rows.map((row) => row.name));
    for (const expected of [
      "device_product_assignments_source_valid", "device_product_assignments_revocation_shape",
      "device_product_assignments_device_fk", "device_product_assignments_product_fk",
      "device_product_assignments_active_unique", "device_product_assignments_device_idx",
      "device_product_assignments_product_idx",
    ]) assert(objectNames.has(expected), `missing assignment schema object ${expected}`);

    const suffix = randomUUID();
    await v2Db.transaction(async (tx) => {
      const nowResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
      const nowValue = (nowResult.rows[0] as { now?: unknown } | undefined)?.now;
      const now = nowValue instanceof Date ? nowValue : new Date(String(nowValue));
      assert(Number.isFinite(now.getTime()));
      const future = new Date(now.getTime() + 30 * 86_400_000);
      const past = new Date(now.getTime() - 30 * 86_400_000);

      async function ensureProduct(code: string, kind: "core" | "partner") {
        await tx.insert(schema.commercialProducts).values({ code, kind, name: `Test ${code}`, isActive: true })
          .onConflictDoNothing({ target: schema.commercialProducts.code });
        const [product] = await tx.select().from(schema.commercialProducts).where(eq(schema.commercialProducts.code, code)).limit(1);
        assert(product, `test ${code} product is available`);
        if (!product.isActive) await tx.update(schema.commercialProducts).set({ isActive: true }).where(eq(schema.commercialProducts.id, product.id));
        return product;
      }
      const basic = await ensureProduct("soundspa", "core");
      const spaquatoria = await ensureProduct("spaquatoria", "partner");
      const [provider] = await tx.insert(schema.commercialPaymentProviders).values({ code: `device-test-${suffix.slice(0, 8)}`, displayName: "Device assignment test", isEnabled: true }).returning();

      async function createLocation(name: string, archivedAt: Date | null = null) {
        const [organization] = await tx.insert(schema.organizations).values({ name: `${name} org ${suffix}` }).returning();
        const [location] = await tx.insert(schema.locations).values({
          organizationId: organization.id, name, slug: `${name.toLowerCase().replaceAll(" ", "-")}-${suffix.slice(0, 8)}`,
          timezone: "UTC", archivedAt,
        }).returning();
        return { organization, location };
      }
      async function createDevices(locationId: string, count: number, credential = true) {
        return tx.insert(schema.devices).values(Array.from({ length: count }, (_, i) => ({
          locationId, status: "active" as const,
          credentialHash: credential ? `test-credential-hash-${suffix}-${locationId}-${i}` : null,
        }))).returning();
      }

      // Exactly five active Basic Trial Devices are eligible and backfilled.
      const trial = await createLocation("Trial");
      const [trialRow] = await tx.insert(schema.organizationCoreTrials).values({
        organizationId: trial.organization.id, productId: basic.id, status: "active", startsAt: past, endsAt: future,
        origin: "first_location_creation", createdAt: past, updatedAt: past,
      }).returning();
      await tx.insert(schema.organizationCoreTrialLocations).values({
        organizationTrialId: trialRow!.id, organizationId: trial.organization.id, locationId: trial.location.id,
        slotNumber: 1, source: "first_location_creation", allocatedAt: past,
      });
      const trialDevices = await createDevices(trial.location.id, 5);
      const pending = (await createDevices(trial.location.id, 1, false))[0]!;
      const revoked = (await tx.insert(schema.devices).values({ locationId: trial.location.id, status: "revoked", credentialHash: `revoked-${suffix}`, revokedAt: now }).returning())[0]!;

      // A paid Location can have more than five active Devices; paid coverage supersedes the trial cap.
      const paid = await createLocation("Paid");
      const paidDevices = await createDevices(paid.location.id, 6);
      await tx.insert(schema.locationSubscriptions).values({
        locationId: paid.location.id, productId: basic.id, provider: provider!.code, status: "active",
        startsAt: past, currentPeriodEndsAt: future,
      });

      // A Basic promotional grant is still Basic; it is independent of the Organization Trial.
      const promotional = await createLocation("Promotional");
      const promoDevice = (await createDevices(promotional.location.id, 1))[0]!;
      await tx.insert(schema.locationProductPromotionalAccess).values({
        locationId: promotional.location.id, productId: basic.id, source: "operator", durationUnit: "days", durationValue: 30,
        grantedAt: now, startsAt: past, endsAt: future, status: "granted", grantedByOperator: "test-operator",
        reasonCode: "testing", reason: "Disposable integration test grant", operatorRequestId: randomUUID(),
      });

      // Existing Spaquatoria entitlement must not be implicitly converted to a Device assignment.
      const partner = (await tx.insert(schema.commercialPartners).values({ code: `device-test-${suffix}`, name: `Device test ${suffix}`, isActive: true }).returning())[0]!;
      await tx.insert(schema.commercialPartnerBenefits).values({
        partnerId: partner.id, productId: spaquatoria.id, locationId: trial.location.id, startsAt: past, endsAt: future,
      });

      // Expired access and archived Locations are not newly active assignments; their Device rows remain.
      const expired = await createLocation("Expired");
      const [expiredTrial] = await tx.insert(schema.organizationCoreTrials).values({
        organizationId: expired.organization.id, productId: basic.id, status: "expired", startsAt: new Date(past.getTime() - 28 * 86_400_000), endsAt: past,
        origin: "first_location_creation", createdAt: past, updatedAt: past,
      }).returning();
      await tx.insert(schema.organizationCoreTrialLocations).values({
        organizationTrialId: expiredTrial!.id, organizationId: expired.organization.id, locationId: expired.location.id,
        slotNumber: 1, source: "first_location_creation", allocatedAt: past,
      });
      const expiredDevice = (await createDevices(expired.location.id, 1))[0]!;
      const archived = await createLocation("Archived", now);
      const archivedDevice = (await createDevices(archived.location.id, 1))[0]!;

      const firstCount = await backfillActivatedBasicDeviceAssignmentsInTransaction(tx);
      assert.equal(firstCount, 12, "5 trial + 6 paid + 1 current Basic promotional assignments");
      assert.equal(await backfillActivatedBasicDeviceAssignmentsInTransaction(tx), 0, "repeat backfill is idempotent");

      const fixtureDeviceIds = [...trialDevices, ...paidDevices, promoDevice].map((device) => device.id);
      const activeBasic = await tx.select().from(schema.deviceProductAssignments).where(and(
        eq(schema.deviceProductAssignments.productId, basic.id),
        inArray(schema.deviceProductAssignments.deviceId, fixtureDeviceIds),
      ));
      assert.equal(activeBasic.length, 12);
      assert.equal(activeBasic.filter((row) => row.source === "legacy_basic_backfill").length, 12);
      assert.equal(activeBasic.filter((row) => trialDevices.some((device) => device.id === row.deviceId)).length, 5);
      assert(!activeBasic.some((row) => [pending.id, revoked.id, expiredDevice.id, archivedDevice.id].includes(row.deviceId)),
        "pending, revoked, expired, and archived Devices do not get active Basic assignments");
      assert(activeBasic.some((row) => row.deviceId === promoDevice.id), "active Basic promotional access backfills as Basic");
      assert.equal((await tx.select().from(schema.deviceProductAssignments).where(eq(schema.deviceProductAssignments.productId, spaquatoria.id))).length, 0,
        "Spaquatoria Partner Benefit is not automatically assigned");

      // A sixth trial Device fails closed, while six Paid Basic Devices backfill successfully above.
      const overQuota = await createLocation("Over quota");
      const [overTrial] = await tx.insert(schema.organizationCoreTrials).values({
        organizationId: overQuota.organization.id, productId: basic.id, status: "active", startsAt: past, endsAt: future,
        origin: "first_location_creation", createdAt: past, updatedAt: past,
      }).returning();
      await tx.insert(schema.organizationCoreTrialLocations).values({
        organizationTrialId: overTrial!.id, organizationId: overQuota.organization.id, locationId: overQuota.location.id,
        slotNumber: 1, source: "first_location_creation", allocatedAt: past,
      });
      await createDevices(overQuota.location.id, 6);
      await assert.rejects(backfillActivatedBasicDeviceAssignmentsInTransaction(tx), /more than five activated Devices/);

      // One Device may be assigned to both Products; active uniqueness is product-scoped.
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: trialDevices[0]!.id, productId: spaquatoria.id, source: "operator" });
      const sameDeviceProducts = await tx.select().from(schema.deviceProductAssignments)
        .where(eq(schema.deviceProductAssignments.deviceId, trialDevices[0]!.id));
      assert.equal(sameDeviceProducts.length, 2);

      assert.equal(policy.deviceProductAssignmentLimit("soundspa", "basic_trial"), 5);
      assert.equal(policy.canAssignActivatedDevice(5, 4), true);
      assert.equal(policy.canAssignActivatedDevice(5, 5), false);
      assert.equal(policy.deviceProductAssignmentLimit("soundspa", ["basic_trial", "basic_paid"]), null);
      assert(Array.from({ length: 6 }, (_, i) => policy.canAssignActivatedDevice(null, i)).every(Boolean), "paid Basic policy is unlimited");
      assert.equal(policy.deviceProductAssignmentLimit("spaquatoria", "spaquatoria_gift"), 1);
      assert.equal(policy.canAssignActivatedDevice(1, 1), false, "Spaquatoria quota is independent");

      throw new RollbackFixture();
    }).catch((error: unknown) => { if (!(error instanceof RollbackFixture)) throw error; });

    console.info("V2 Device–Product PostgreSQL 16 integration PASS: additive schema objects, Basic Trial five-device cap, paid Basic unlimited, Basic promotional backfill, Spaquatoria non-backfill, independent Product assignments, pending/revoked/expired/archived exclusion, over-quota fail-closed, and idempotency. All fixtures rolled back.");
  } finally {
    await v2Pool.end();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
