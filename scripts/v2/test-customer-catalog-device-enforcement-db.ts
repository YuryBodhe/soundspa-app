import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

class RollbackFixture extends Error {}
const testUrl = process.env.V2_CUSTOMER_CATALOG_DEVICE_TEST_DATABASE_URL;
assert(testUrl, "Set V2_CUSTOMER_CATALOG_DEVICE_TEST_DATABASE_URL to a disposable local PostgreSQL 16 restore.");
const parsed = new URL(testUrl);
assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "Refusing non-local catalog integration database.");
assert.equal(decodeURIComponent(parsed.pathname), "/soundspa_v2");
assert.equal(decodeURIComponent(parsed.username), "soundspa_v2_test", "Use the dedicated non-superuser test role.");
process.env.V2_DATABASE_URL = testUrl;

async function main() {
  const [{ v2Db, v2Pool }, schema, { getCustomerCatalogProductPolicy }, { resolveEffectiveChannelAccess }, { filterCustomerCatalogChannels }, { getLocationCustomerCatalog }] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/queries/customerCatalogPolicy"),
    import("../../db/v2/queries/effectiveAccess"),
    import("../../lib/v2/customerCatalogModel"),
    import("../../lib/v2/customerCatalog"),
  ]);
  try {
    const identity = await v2Pool.query<{ current_database: string; current_user: string; server_version_num: string }>(
      "SELECT current_database(), current_user, current_setting('server_version_num') AS server_version_num",
    );
    assert.equal(identity.rows[0]?.current_database, "soundspa_v2");
    assert.equal(identity.rows[0]?.current_user, "soundspa_v2_test");
    assert.equal(Math.floor(Number(identity.rows[0]?.server_version_num) / 10_000), 16);
    const ledger = await v2Pool.query<{ count: string; last_hash: string | null }>(
      'SELECT count(*)::text AS count, max(hash) AS last_hash FROM "drizzle_v2"."__drizzle_migrations"',
    );
    assert.equal(ledger.rows[0]?.count, "37", "isolated restore must include migration 0036; this test never migrates");

    const [basic] = await v2Db.select().from(schema.commercialProducts).where(eq(schema.commercialProducts.code, "soundspa")).limit(1);
    const [spa] = await v2Db.select().from(schema.commercialProducts).where(eq(schema.commercialProducts.code, "spaquatoria")).limit(1);
    assert(basic?.isActive && spa?.isActive, "Basic and Spaquatoria products must be active in the restored catalog");
    const [e2eOrg] = await v2Db.select().from(schema.organizations).where(eq(schema.organizations.name, "SoundSpa E2E Test 01")).limit(1);
    assert(e2eOrg, "expected existing E2E organization in the staging restore");
    const e2eLocations = await v2Db.select().from(schema.locations)
      .where(eq(schema.locations.organizationId, e2eOrg.id)).orderBy(schema.locations.createdAt);
    const e2eLocation = e2eLocations.find(({ name }) => name === "Salon E2E Test 01");
    assert(e2eLocation, "expected E2E Location 1 in staging restore");
    const [canonicalTrial] = await v2Db.select().from(schema.organizationCoreTrials)
      .where(and(eq(schema.organizationCoreTrials.organizationId, e2eOrg.id), eq(schema.organizationCoreTrials.productId, basic.id))).limit(1);
    assert(canonicalTrial);
    assert.equal(canonicalTrial.startsAt.toISOString(), "2026-11-08T05:40:47.733Z");
    assert.equal(canonicalTrial.endsAt.toISOString(), "2026-12-06T05:40:47.733Z");
    const e2eSlots = await v2Db.select().from(schema.organizationCoreTrialLocations)
      .where(eq(schema.organizationCoreTrialLocations.organizationTrialId, canonicalTrial.id));
    assert.equal(e2eSlots.length, 2);
    const [legacyTrial] = await v2Db.select().from(schema.locationCoreTrials)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.locationCoreTrials.locationId))
      .where(and(eq(schema.locations.id, e2eLocation.id), eq(schema.locationCoreTrials.productId, basic.id))).limit(1);
    assert(legacyTrial);
    assert.equal(legacyTrial.location_core_trials.startsAt.toISOString(), "2026-11-08T05:40:47.733Z");
    assert.equal(legacyTrial.location_core_trials.endsAt.toISOString(), "2026-12-06T05:40:47.733Z");
    assert.equal(legacyTrial.location_core_trials.status, "active");
    const e2eDevices = await v2Db.select().from(schema.devices)
      .where(and(eq(schema.devices.locationId, e2eLocation.id), eq(schema.devices.status, "active"), isNull(schema.devices.revokedAt)));
    assert.equal(e2eDevices.length, 1, "E2E Location 1 should still have exactly one active Device");
    const e2eDevice = e2eDevices[0]!;
    assert.equal(e2eDevice.id, "828284d8-ef05-40bf-8842-2b25f547b93a", "existing E2E Device identity must remain unchanged");
    const e2eAssignments = await v2Db.select().from(schema.deviceProductAssignments).where(and(
      eq(schema.deviceProductAssignments.deviceId, e2eDevice.id), isNull(schema.deviceProductAssignments.revokedAt),
    ));
    assert.deepEqual(e2eAssignments.map(({ productId }) => productId), [basic.id], "E2E Device must have one Basic and no Spaquatoria assignment");

    const e2eAccess = await resolveEffectiveChannelAccess(e2eLocation.id, new Date("2026-11-09T00:00:00.000Z"));
    const e2ePolicy = await getCustomerCatalogProductPolicy(e2eLocation.id, undefined, e2eDevice.id);
    const e2eCatalog = filterCustomerCatalogChannels(e2eAccess, new Set(), e2ePolicy);
    const e2eBasicChannels = e2eCatalog.filter(({ catalogProducts }) => catalogProducts.some(({ id }) => id === basic.id));
    assert.equal(e2eBasicChannels.length, 9, "existing E2E Device must retain all nine Basic channels");
    assert(e2eBasicChannels.every(({ playable }) => playable), "all currently entitled E2E Basic channels remain playable");
    assert(e2eBasicChannels.every(({ productAccessSources }) => productAccessSources[basic.id]?.length === 1 && productAccessSources[basic.id]?.[0] === "trial"),
      "legacy Location trial does not duplicate canonical Basic trial access");
    assert(!e2eCatalog.some(({ catalogProducts }) => catalogProducts.some(({ id }) => id === spa.id)), "E2E Device has no implicit Spaquatoria access");
    const assembledE2eCatalog = await getLocationCustomerCatalog(e2eLocation.id, new Date("2026-11-09T00:00:00.000Z"), e2eDevice.id);
    assert.equal(assembledE2eCatalog.length, 9, "the actual customer catalog assembly preserves nine Basic channel records");
    assert(assembledE2eCatalog.every((channel) => channel.playable && channel.catalogProducts.some(({ id }) => id === basic.id)));
    assert.deepEqual(Object.keys(assembledE2eCatalog[0]!).sort(), [
      "accessExpiries", "accessSources", "catalogProducts", "description", "displayName", "id", "imageUrl", "kind", "localizedTitles", "playable", "slug", "suspended", "tracks",
    ]);

    const suffix = randomUUID();
    await v2Db.transaction(async (tx) => {
      const now = new Date("2026-11-09T00:00:00.000Z");
      const past = new Date(now.getTime() - 60_000);
      const future = new Date(now.getTime() + 86_400_000);
      const [provider] = await tx.insert(schema.commercialPaymentProviders).values({
        code: `catalog-${suffix.slice(0, 8)}`, displayName: "Catalog enforcement integration", isEnabled: false,
      }).returning();
      const [partner] = await tx.insert(schema.commercialPartners).values({
        code: `catalog-${suffix}`, name: "Catalog enforcement integration", isActive: true,
      }).returning();
      const [org] = await tx.insert(schema.organizations).values({ name: `catalog-enforcement-${suffix}` }).returning();
      const [location] = await tx.insert(schema.locations).values({
        organizationId: org!.id, name: "Entitlement fixture", slug: `catalog-enforcement-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [device] = await tx.insert(schema.devices).values({
        locationId: location!.id, credentialHash: `catalog-enforcement-${suffix}`, status: "active",
      }).returning();
      const [basicChannel] = await tx.select({ channelId: schema.commercialProductChannels.channelId })
        .from(schema.commercialProductChannels).where(eq(schema.commercialProductChannels.productId, basic!.id)).limit(1);
      const [spaChannel] = await tx.select({ channelId: schema.commercialProductChannels.channelId })
        .from(schema.commercialProductChannels).where(eq(schema.commercialProductChannels.productId, spa!.id)).limit(1);
      assert(basicChannel && spaChannel, "fixture must have independent Basic and Spaquatoria catalog channels");

      const [trial] = await tx.insert(schema.organizationCoreTrials).values({
        organizationId: org!.id, productId: basic!.id, status: "active", startsAt: past, endsAt: future,
        origin: "first_location_creation", createdAt: past, updatedAt: past,
      }).returning();
      await tx.insert(schema.organizationCoreTrialLocations).values({
        organizationTrialId: trial!.id, organizationId: org!.id, locationId: location!.id,
        slotNumber: 1, source: "first_location_creation", allocatedAt: past,
      });
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: device!.id, productId: basic!.id, source: "operator" });

      const access = await resolveEffectiveChannelAccess(location!.id, now, tx);
      const devicePolicy = await getCustomerCatalogProductPolicy(location!.id, tx, device!.id);
      const basicResult = filterCustomerCatalogChannels(access, new Set(), devicePolicy);
      assert(basicResult.some(({ id, productAccessSources }) => id === basicChannel!.channelId && productAccessSources[basic!.id]?.includes("trial")));
      assert(!basicResult.some(({ id }) => id === spaChannel!.channelId), "Basic assignment cannot confer Spaquatoria access");

      await tx.insert(schema.commercialPartnerBenefits).values({
        partnerId: partner!.id, productId: spa!.id, locationId: location!.id, startsAt: past, endsAt: future,
      });
      const spaEntitledWithoutAssignment = await resolveEffectiveChannelAccess(location!.id, now, tx);
      const noSpaAssignmentPolicy = await getCustomerCatalogProductPolicy(location!.id, tx, device!.id);
      assert(!filterCustomerCatalogChannels(spaEntitledWithoutAssignment, new Set(), noSpaAssignmentPolicy)
        .some(({ id }) => id === spaChannel!.channelId), "Partner Benefit alone cannot assign Spaquatoria");
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: device!.id, productId: spa!.id, source: "operator" });
      const bothPolicy = await getCustomerCatalogProductPolicy(location!.id, tx, device!.id);
      const bothResult = filterCustomerCatalogChannels(spaEntitledWithoutAssignment, new Set(), bothPolicy);
      assert(bothResult.some(({ id, productAccessSources }) => id === basicChannel!.channelId && productAccessSources[basic!.id]?.includes("trial")));
      assert(bothResult.some(({ id, productAccessSources }) => id === spaChannel!.channelId && productAccessSources[spa!.id]?.includes("partner_benefit")));

      const [promoLocation] = await tx.insert(schema.locations).values({
        organizationId: org!.id, name: "Promotional fixture", slug: `catalog-promo-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [promoDevice] = await tx.insert(schema.devices).values({
        locationId: promoLocation!.id, credentialHash: `catalog-promo-${suffix}`, status: "active",
      }).returning();
      await tx.insert(schema.locationProductPromotionalAccess).values({
        locationId: promoLocation!.id, productId: basic!.id, source: "operator", durationUnit: "days", durationValue: 1,
        grantedAt: past, startsAt: past, endsAt: future, status: "granted", grantedByOperator: "test-operator",
        reasonCode: "testing", reason: "Catalog enforcement isolated test", operatorRequestId: randomUUID(),
      });
      await tx.insert(schema.commercialPartnerBenefits).values({
        partnerId: partner!.id, productId: basic!.id, locationId: promoLocation!.id, startsAt: past, endsAt: future,
      });
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: promoDevice!.id, productId: basic!.id, source: "operator" });
      const promoAccess = await resolveEffectiveChannelAccess(promoLocation!.id, now, tx);
      const promoPolicy = await getCustomerCatalogProductPolicy(promoLocation!.id, tx, promoDevice!.id);
      assert(filterCustomerCatalogChannels(promoAccess, new Set(), promoPolicy)
        .some(({ productAccessSources }) => Object.values(productAccessSources).some((sources) => sources.includes("promotional_access"))));
      assert(filterCustomerCatalogChannels(promoAccess, new Set(), promoPolicy)
        .some(({ productAccessSources }) => Object.values(productAccessSources).some((sources) => sources.includes("partner_benefit"))));

      const [paidLocation] = await tx.insert(schema.locations).values({
        organizationId: org!.id, name: "Paid fixture", slug: `catalog-paid-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [paidDevice] = await tx.insert(schema.devices).values({
        locationId: paidLocation!.id, credentialHash: `catalog-paid-${suffix}`, status: "active",
      }).returning();
      await tx.insert(schema.locationSubscriptions).values({
        locationId: paidLocation!.id, productId: basic!.id, provider: provider!.code, status: "active", startsAt: past, currentPeriodEndsAt: future,
      });
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: paidDevice!.id, productId: basic!.id, source: "operator" });
      const paidAccess = await resolveEffectiveChannelAccess(paidLocation!.id, now, tx);
      const paidPolicy = await getCustomerCatalogProductPolicy(paidLocation!.id, tx, paidDevice!.id);
      assert(filterCustomerCatalogChannels(paidAccess, new Set(), paidPolicy)
        .some(({ productAccessSources }) => Object.values(productAccessSources).some((sources) => sources.includes("subscription"))));

      const [expiredOrg] = await tx.insert(schema.organizations).values({ name: `catalog-expired-${suffix}` }).returning();
      const [expiredLocation] = await tx.insert(schema.locations).values({
        organizationId: expiredOrg!.id,
        name: "Expired fixture", slug: `catalog-expired-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [expiredDevice] = await tx.insert(schema.devices).values({
        locationId: expiredLocation!.id, credentialHash: `catalog-expired-${suffix}`, status: "active",
      }).returning();
      const [expiredTrial] = await tx.insert(schema.organizationCoreTrials).values({
        organizationId: expiredOrg!.id, productId: basic!.id, status: "expired", startsAt: new Date(past.getTime() - 86_400_000), endsAt: past,
        origin: "first_location_creation", createdAt: past, updatedAt: past,
      }).returning();
      await tx.insert(schema.organizationCoreTrialLocations).values({
        organizationTrialId: expiredTrial!.id, organizationId: expiredOrg!.id, locationId: expiredLocation!.id,
        slotNumber: 1, source: "additional_location_creation", allocatedAt: past,
      });
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: expiredDevice!.id, productId: basic!.id, source: "operator" });
      const expiredAccess = await resolveEffectiveChannelAccess(expiredLocation!.id, now, tx);
      const expiredPolicy = await getCustomerCatalogProductPolicy(expiredLocation!.id, tx, expiredDevice!.id);
      assert(!filterCustomerCatalogChannels(expiredAccess, new Set(), expiredPolicy).some(({ id }) => id === basicChannel!.channelId),
        "expired entitlement removes Basic channels while retaining the assignment row");
      assert.equal((await tx.select({ id: schema.deviceProductAssignments.id }).from(schema.deviceProductAssignments)
        .where(and(eq(schema.deviceProductAssignments.deviceId, expiredDevice!.id), eq(schema.deviceProductAssignments.productId, basic!.id), isNull(schema.deviceProductAssignments.revokedAt)))).length, 1,
        "commercial expiry does not delete Device assignment history");

      const [rejectedLocation] = await tx.insert(schema.locations).values({
        organizationId: expiredOrg!.id, name: "Inactive grant fixture", slug: `catalog-inactive-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [rejectedDevice] = await tx.insert(schema.devices).values({
        locationId: rejectedLocation!.id, credentialHash: `catalog-inactive-${suffix}`, status: "active",
      }).returning();
      const [inactivePartner] = await tx.insert(schema.commercialPartners).values({
        code: `catalog-inactive-${suffix}`, name: "Inactive catalog fixture", isActive: false,
      }).returning();
      await tx.insert(schema.commercialPartnerBenefits).values([
        { partnerId: partner!.id, productId: basic!.id, locationId: rejectedLocation!.id, startsAt: new Date(past.getTime() - 86_400_000), endsAt: past },
        { partnerId: inactivePartner!.id, productId: basic!.id, locationId: rejectedLocation!.id, startsAt: past, endsAt: future },
      ]);
      await tx.insert(schema.locationProductPromotionalAccess).values([
        { locationId: rejectedLocation!.id, productId: basic!.id, source: "operator", durationUnit: "days", durationValue: 1,
          grantedAt: past, startsAt: past, endsAt: future, status: "revoked", grantedByOperator: "test-operator",
          reasonCode: "testing", reason: "Revoked isolated access", operatorRequestId: randomUUID(), revokedAt: now,
          revokedByOperator: "test-operator", revokeReason: "Revoked for isolated test" },
        { locationId: rejectedLocation!.id, productId: basic!.id, source: "operator", durationUnit: "days", durationValue: 1,
          grantedAt: past, startsAt: new Date(past.getTime() - 86_400_000), endsAt: past, status: "granted",
          grantedByOperator: "test-operator", reasonCode: "testing", reason: "Expired isolated access", operatorRequestId: randomUUID() },
      ]);
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: rejectedDevice!.id, productId: basic!.id, source: "operator" });
      const rejectedAccess = await resolveEffectiveChannelAccess(rejectedLocation!.id, now, tx);
      const rejectedPolicy = await getCustomerCatalogProductPolicy(rejectedLocation!.id, tx, rejectedDevice!.id);
      assert(!filterCustomerCatalogChannels(rejectedAccess, new Set(), rejectedPolicy).some(({ id }) => id === basicChannel!.channelId),
        "expired Partner Benefits, inactive partners, and expired/revoked Promotional Access do not authorize a Device");

      const [pendingLocation] = await tx.insert(schema.locations).values({
        organizationId: org!.id, name: "Pending credential fixture", slug: `catalog-pending-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [pendingDevice] = await tx.insert(schema.devices).values({
        locationId: pendingLocation!.id, credentialHash: null, status: "active",
      }).returning();
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: pendingDevice!.id, productId: basic!.id, source: "operator" });
      const pendingPolicy = await getCustomerCatalogProductPolicy(pendingLocation!.id, tx, pendingDevice!.id);
      assert.deepEqual(pendingPolicy.activeDeviceProductIds, new Set(), "a row without an active credential is not a Device assignment for catalog authorization");

      const [archivedOrg] = await tx.insert(schema.organizations).values({ name: `catalog-archived-${suffix}` }).returning();
      const [archivedLocation] = await tx.insert(schema.locations).values({
        organizationId: archivedOrg!.id, name: "Archived fixture", slug: `catalog-archived-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [archivedDevice] = await tx.insert(schema.devices).values({
        locationId: archivedLocation!.id, credentialHash: `catalog-archived-${suffix}`, status: "active",
      }).returning();
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: archivedDevice!.id, productId: basic!.id, source: "operator" });
      await tx.update(schema.locations).set({ archivedAt: now }).where(eq(schema.locations.id, archivedLocation!.id));
      const archivedAccess = await resolveEffectiveChannelAccess(archivedLocation!.id, now, tx);
      assert.deepEqual(archivedAccess, [], "archived Location cannot expose catalog channels");

      const [archivedOrg2] = await tx.insert(schema.organizations).values({ name: `catalog-archived-org-${suffix}` }).returning();
      const [archivedOrgLocation] = await tx.insert(schema.locations).values({
        organizationId: archivedOrg2!.id, name: "Archived organization fixture", slug: `catalog-archived-org-${suffix.slice(0, 8)}`, timezone: "UTC",
      }).returning();
      const [archivedOrgDevice] = await tx.insert(schema.devices).values({
        locationId: archivedOrgLocation!.id, credentialHash: `catalog-archived-org-${suffix}`, status: "active",
      }).returning();
      await tx.insert(schema.deviceProductAssignments).values({ deviceId: archivedOrgDevice!.id, productId: basic!.id, source: "operator" });
      await tx.update(schema.organizations).set({ archivedAt: now }).where(eq(schema.organizations.id, archivedOrg2!.id));
      assert.deepEqual(await resolveEffectiveChannelAccess(archivedOrgLocation!.id, now, tx), [], "archived Organization cannot expose catalog channels");

      throw new RollbackFixture();
    }).catch((error: unknown) => { if (!(error instanceof RollbackFixture)) throw error; });

    console.info("V2 Device–Product catalog PostgreSQL 16 integration PASS: restored E2E Basic trial/device/9 channels; Basic and Spaquatoria assignments remain independent; active Benefit, Promotional Access, and Paid Basic sources authorize only assigned Products; assignment-only, entitlement-only, expired, and archived cases fail closed. Fixtures rolled back.");
  } finally {
    await v2Pool.end();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
