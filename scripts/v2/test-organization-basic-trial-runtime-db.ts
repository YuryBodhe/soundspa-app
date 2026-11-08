import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

class RollbackFixture extends Error {}
const TEST_URL = process.env.V2_ORG_TRIAL_RUNTIME_TEST_DATABASE_URL;
assert(TEST_URL, "Set V2_ORG_TRIAL_RUNTIME_TEST_DATABASE_URL to a disposable local PostgreSQL 16 database.");
const parsed = new URL(TEST_URL);
assert(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "runtime trial test database must be loopback-only");
assert.equal(decodeURIComponent(parsed.pathname), "/soundspa_v2");
assert.notEqual(decodeURIComponent(parsed.username), "postgres");
process.env.V2_DATABASE_URL = TEST_URL;

async function main() {
const [{ v2Db, v2Pool }, { createCustomerLocation }, { completeOrdinaryCustomerOnboarding }, { createCustomerWithFirstLocationInTransaction }, { allocateAdditionalOrganizationBasicTrialLocation, provisionFirstOrganizationBasicTrial }, { resolveCommercialProductChannelAccess }, { resolveEffectiveChannelAccess }, schema, { and, eq }] = await Promise.all([
  import("../../db/v2/client"),
  import("../../db/v2/services/customerLocations"),
  import("../../db/v2/services/customerOnboarding"),
  import("../../db/v2/services/customerProvisioning"),
  import("../../db/v2/services/organizationBasicTrial"),
  import("../../db/v2/queries/commercialAccess"),
  import("../../db/v2/queries/effectiveAccess"),
  import("../../db/v2/schema"),
  import("drizzle-orm"),
]);
const { commercialProducts, locations, organizationCoreTrialLocations, organizationCoreTrials, organizationMembers, organizations } = schema;

const migrations = await v2Pool.query<{ count: string; latest: string }>(
  "SELECT count(*)::text AS count, max(created_at)::text AS latest FROM drizzle_v2.__drizzle_migrations",
);
assert.equal(migrations.rows[0]?.count, "36", "test database must be migrated through V2 migration 0035");
assert.equal(migrations.rows[0]?.latest, "1794145936847");
const identity = await v2Pool.query<{ version: string; address: string | null; role: string }>(
  "SELECT current_setting('server_version_num') AS version, inet_server_addr()::text AS address, current_user AS role",
);
assert(identity.rows[0]?.version.startsWith("16"), "tests require isolated PostgreSQL 16");
assert(["127.0.0.1", "::1"].includes(identity.rows[0]?.address?.split("/")[0] ?? ""));
assert.notEqual(identity.rows[0]?.role, "postgres");

const empty = await v2Pool.query<{ count: string }>(`SELECT
  (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) +
  (SELECT count(*) FROM organization_core_trials) + (SELECT count(*) FROM organization_core_trial_locations) +
  (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM location_subscriptions) +
  (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM commercial_promotional_access.location_product_promotional_access) AS count`);
assert.equal(empty.rows[0]?.count, "0", "disposable test database must not contain customer data");

const suffix = randomUUID();
const createdProductIds: string[] = [];
let basicProductId = "";
const basicProduct = await v2Db.select({ id: commercialProducts.id }).from(commercialProducts).where(eq(commercialProducts.code, "soundspa")).limit(1);
if (basicProduct[0]) basicProductId = basicProduct[0].id;
else {
  const [product] = await v2Db.insert(commercialProducts).values({ code: "soundspa", name: "SoundSpa Basic", kind: "core", visibility: "public", catalogVisibility: "public" }).returning({ id: commercialProducts.id });
  basicProductId = product.id;
  createdProductIds.push(product.id);
}

  try {
    await v2Db.transaction(async (outer) => {
      const nested = <T>(operation: (tx: typeof outer) => Promise<T>) => outer.transaction(operation);
      const [user] = await outer.insert((await import("../../db/v2/schema")).users).values({ email: `trial-runtime-${suffix}@example.test`, emailVerifiedAt: new Date() }).returning();
      const [intent] = await outer.insert((await import("../../db/v2/schema")).customerSignupIntents).values({
        email: user.email, locale: "en", expiresAt: new Date(Date.now() + 60_000), verifiedAt: new Date(), completedAt: new Date(),
      }).returning();
      const organizationName = `Org trial runtime ${suffix}`;
      const onboard = await completeOrdinaryCustomerOnboarding({
        authenticatedUserId: user.id, signupIntentId: intent.id, organizationName, locationName: "Location 1", timezone: "UTC",
      }, { runInTransaction: nested });
      assert.equal(onboard.status, "completed");
      const { organization, location, trial } = onboard.account;
      assert(trial);
      assert.equal(trial.endsAt.getTime() - trial.startsAt.getTime(), 28 * 24 * 60 * 60 * 1000);
      const canonicalBefore = (await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.organizationId, organization.id)))[0]!;
      assert.equal(canonicalBefore.origin, "first_location_creation");
      const firstSlot = (await outer.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.locationId, location.id)))[0]!;
      assert.equal(firstSlot.slotNumber, 1);
      assert.equal(firstSlot.source, "first_location_creation");
      const repeatedProvision = await provisionFirstOrganizationBasicTrial(outer, organization.id, location.id);
      assert.equal(repeatedProvision.trial.id, canonicalBefore.id, "repeated provisioning reuses the immutable canonical trial");
      assert.equal(repeatedProvision.slot?.id, firstSlot.id, "repeated provisioning reuses the first Location slot");
      assert.equal((await outer.select().from((await import("../../db/v2/schema")).locationCoreTrials).where(and(
        eq((await import("../../db/v2/schema")).locationCoreTrials.locationId, location.id), eq((await import("../../db/v2/schema")).locationCoreTrials.productId, basicProductId),
      ))).length, 0, "canonical Basic is not duplicated in the legacy table");

      const added = [] as { id: string; name: string }[];
      for (let index = 2; index <= 6; index++) {
        added.push(await createCustomerLocation({ authenticatedUserId: user.id, organizationId: organization.id, name: `Location ${index}`, timezone: "UTC" }, {
          transaction: nested as never,
        }));
      }
      const slots = await outer.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.organizationId, organization.id));
      assert.equal(slots.length, 5, "at most five unique Location slots are ever allocated");
      assert.deepEqual(slots.map((slot) => slot.slotNumber).sort(), [1, 2, 3, 4, 5]);
      assert.equal(slots.find((slot) => slot.locationId === added[4]!.id), undefined, "Location 6 has no Basic trial slot");
      const canonicalAfter = (await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.organizationId, organization.id)))[0]!;
      assert.equal(canonicalAfter.startsAt.getTime(), canonicalBefore.startsAt.getTime());
      assert.equal(canonicalAfter.endsAt.getTime(), canonicalBefore.endsAt.getTime(), "new Locations never extend the shared window");

      const [retry] = await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.organizationId, organization.id));
      assert.equal(retry.id, canonicalBefore.id, "repeated requests keep the same canonical row");

      const [basicChannel] = await outer.insert(schema.channels).values({ slug: `trial-basic-${suffix}`, displayName: "Trial Basic", kind: "music", isPublished: true }).returning();
      await outer.insert(schema.commercialProductChannels).values({ productId: basicProductId, channelId: basicChannel.id });
      const [spaquatoriaProduct] = await outer.insert(commercialProducts).values({ code: `trial-spaq-${suffix}`, name: "Trial Spaquatoria", kind: "partner" }).returning();
      const [spaquatoriaChannel] = await outer.insert(schema.channels).values({ slug: `trial-spaq-${suffix}`, displayName: "Trial Spaquatoria", kind: "music", isPublished: true }).returning();
      await outer.insert(schema.commercialProductChannels).values({ productId: spaquatoriaProduct.id, channelId: spaquatoriaChannel.id });
      const [partner] = await outer.insert(schema.commercialPartners).values({ code: `trial-partner-${suffix}`, name: "Trial partner" }).returning();
      await outer.insert(schema.commercialPartnerBenefits).values({ partnerId: partner.id, productId: spaquatoriaProduct.id, locationId: added[0]!.id, startsAt: trial.startsAt, endsAt: null });
      const [provider] = await outer.insert(schema.commercialPaymentProviders).values({ code: `trial-provider-${suffix.slice(0, 12)}`, displayName: "Runtime trial provider" }).returning();
      await outer.insert(schema.locationSubscriptions).values({ locationId: location.id, productId: basicProductId, provider: provider.code, status: "active", startsAt: trial.startsAt, currentPeriodEndsAt: new Date(trial.endsAt.getTime() + 30 * 86_400_000) });
      const activeBasic = await resolveCommercialProductChannelAccess(location.id, trial.startsAt, outer);
      assert(activeBasic.get(basicProductId)?.get(basicChannel.id)?.has("trial"), "canonical trial resolves before expiry");
      assert(activeBasic.get(basicProductId)?.get(basicChannel.id)?.has("subscription"), "paid Basic access remains independent during trial");
      const afterExpiryBasic = await resolveCommercialProductChannelAccess(added[0]!.id, trial.endsAt, outer);
      assert(!afterExpiryBasic.get(basicProductId)?.get(basicChannel.id)?.has("trial"), "canonical Basic trial stops at its half-open expiry boundary");
      assert(afterExpiryBasic.get(spaquatoriaProduct.id)?.get(spaquatoriaChannel.id)?.has("partner_benefit"), "Spaquatoria Benefit remains available after Basic trial expiry");
      const archivedLocation = added[1]!;
      const archivedAccessBefore = new Map((await resolveEffectiveChannelAccess(archivedLocation.id, trial.startsAt, outer)).map((channel) => [channel.id, channel]));
      assert(archivedAccessBefore.get(basicChannel.id)?.playable, "a trial-enabled Location has effective Basic access before archival");
      await outer.update(locations).set({ archivedAt: new Date() }).where(eq(locations.id, archivedLocation.id));
      assert.deepEqual(await resolveEffectiveChannelAccess(archivedLocation.id, trial.startsAt, outer), [], "archived Locations are not exposed as playable despite retaining their lifetime slot");
      assert.equal((await outer.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.locationId, archivedLocation.id))).length, 1,
        "archiving a Location does not release its trial slot");
      const { endSoundSpaTrial } = await import("../../db/v2/queries/coreTrials");
      const refusedEarlyEnd = await endSoundSpaTrial(location.id, outer, trial.startsAt);
      assert.equal(refusedEarlyEnd.status, "unsupported_shared_trial_operation", "per-Location operator actions cannot terminate a shared immutable Organization trial");
      const unchangedCanonical = (await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.id, canonicalBefore.id)))[0]!;
      assert.equal(unchangedCanonical.startsAt.getTime(), canonicalBefore.startsAt.getTime());
      assert.equal(unchangedCanonical.endsAt.getTime(), canonicalBefore.endsAt.getTime(), "unsupported end requests cannot mutate canonical trial dates");
      await outer.insert(schema.locationCoreTrials).values({ locationId: added[4]!.id, productId: basicProductId, status: "active", startsAt: trial.startsAt, endsAt: trial.endsAt });
      const ignoredLegacyBasic = await resolveCommercialProductChannelAccess(added[4]!.id, trial.startsAt, outer);
      assert(!ignoredLegacyBasic.get(basicProductId)?.get(basicChannel.id)?.has("trial"), "legacy Basic rows cannot grant access without a canonical Location slot");
      const [divnitsa] = await outer.insert(commercialProducts).values({ code: `trial-div-${suffix}`, name: "Trial Divnitsa", kind: "core" }).returning();
      const [divnitsaChannel] = await outer.insert(schema.channels).values({ slug: `trial-div-${suffix}`, displayName: "Trial Divnitsa", kind: "music", isPublished: true }).returning();
      await outer.insert(schema.commercialProductChannels).values({ productId: divnitsa.id, channelId: divnitsaChannel.id });
      await outer.insert(schema.locationCoreTrials).values({ locationId: added[4]!.id, productId: divnitsa.id, status: "active", startsAt: trial.startsAt, endsAt: trial.endsAt });
      const nonBasic = await resolveCommercialProductChannelAccess(added[4]!.id, trial.startsAt, outer);
      assert(nonBasic.get(divnitsa.id)?.get(divnitsaChannel.id)?.has("trial"), "non-Basic legacy Product trials such as Divnitsa remain supported");
      const benefitRows = await outer.select().from(schema.commercialPartnerBenefits).where(and(eq(schema.commercialPartnerBenefits.productId, spaquatoriaProduct.id), eq(schema.commercialPartnerBenefits.locationId, added[0]!.id)));
      assert.equal(benefitRows.length, 1);
      assert.equal(canonicalAfter.endsAt.getTime(), canonicalBefore.endsAt.getTime(), "paid access and partner benefits do not change Organization trial dates");

      const another = await createCustomerWithFirstLocationInTransaction(outer, {
        organizationName: `Expired org ${suffix}`, contactEmail: null, locationName: "Expired Location 1", slug: `expired-${suffix.slice(0, 12)}`, timezone: "UTC",
      }, { provisionBasicTrial: false });
      const past = new Date(Date.now() - 86_400_000);
      const [expired] = await outer.insert(organizationCoreTrials).values({
        organizationId: another.organization.id, productId: basicProductId, status: "active", startsAt: new Date(past.getTime() - 28 * 86_400_000), endsAt: past,
        origin: "first_location_creation", createdAt: past, updatedAt: past,
      }).returning();
      const [secondOwner] = await outer.insert((await import("../../db/v2/schema")).users).values({ email: `expired-owner-${suffix}@example.test`, emailVerifiedAt: new Date() }).returning();
      await outer.insert(organizationMembers).values({ organizationId: another.organization.id, userId: secondOwner.id, role: "owner" });
      const [second] = await outer.insert(locations).values({ organizationId: another.organization.id, name: "Expired Location 2", slug: `expired2-${suffix.slice(0, 12)}`, timezone: "UTC" }).returning();
      assert.equal(await allocateAdditionalOrganizationBasicTrialLocation(outer, another.organization.id, second.id), null,
        "a Location created after expiry receives no trial slot");
      assert.equal((await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.id, expired.id)))[0]!.endsAt.getTime(), past.getTime());

      // Preserve the exact staging E2E window in a rollback-only fixture.
      const e2eStart = new Date("2026-11-08T05:40:47.733Z");
      const e2eEnd = new Date("2026-12-06T05:40:47.733Z");
      const [e2eOrganization] = await outer.insert(organizations).values({ name: `E2E preservation ${suffix}` }).returning();
      const e2eLocations = await outer.insert(locations).values([
        { organizationId: e2eOrganization.id, name: "Salon E2E Test 01", slug: `e2e-one-${suffix.slice(0, 8)}`, timezone: "UTC" },
        { organizationId: e2eOrganization.id, name: "Salon E2E Test 02", slug: `e2e-two-${suffix.slice(0, 8)}`, timezone: "UTC" },
      ]).returning();
      const [e2eLegacy] = await outer.insert(schema.locationCoreTrials).values({
        locationId: e2eLocations[0]!.id, productId: basicProductId, status: "active", startsAt: e2eStart, endsAt: e2eEnd,
      }).returning();
      const [e2eCanonical] = await outer.insert(organizationCoreTrials).values({
        organizationId: e2eOrganization.id, productId: basicProductId, status: "active", startsAt: e2eStart,
        endsAt: e2eEnd, origin: "legacy_backfill", createdAt: e2eStart, updatedAt: e2eStart,
      }).returning();
      await outer.insert(organizationCoreTrialLocations).values([
        { organizationTrialId: e2eCanonical.id, organizationId: e2eOrganization.id, locationId: e2eLocations[0]!.id, slotNumber: 1, source: "legacy_trial", legacyTrialId: e2eLegacy.id, legacyOrigin: "onboarding_inferred", allocatedAt: e2eStart },
        { organizationTrialId: e2eCanonical.id, organizationId: e2eOrganization.id, locationId: e2eLocations[1]!.id, slotNumber: 2, source: "active_window_backfill", allocatedAt: e2eStart },
      ]);
      const [e2eOwner] = await outer.insert(schema.users).values({ email: `e2e-owner-${suffix}@example.test`, emailVerifiedAt: new Date() }).returning();
      await outer.insert(organizationMembers).values({ organizationId: e2eOrganization.id, userId: e2eOwner.id, role: "owner" });
      const e2eThirdLocation = await createCustomerLocation({
        authenticatedUserId: e2eOwner.id, organizationId: e2eOrganization.id, name: "Salon E2E Test 03", timezone: "UTC",
      }, { transaction: nested as never });
      assert.equal((await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.organizationId, e2eOrganization.id))).length, 1,
        "E2E extension preserves one canonical trial");
      assert.equal((await outer.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.organizationId, e2eOrganization.id))).length, 3,
        "the two existing E2E slots remain and an active-window Location receives the next slot");
      assert.equal((await outer.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.locationId, e2eThirdLocation.id)))[0]?.slotNumber, 3);
      const [e2eAfter] = await outer.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.id, e2eCanonical.id));
      const [e2eLegacyAfter] = await outer.select().from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.id, e2eLegacy.id));
      assert.equal(e2eAfter?.startsAt.toISOString(), "2026-11-08T05:40:47.733Z");
      assert.equal(e2eAfter?.endsAt.toISOString(), "2026-12-06T05:40:47.733Z");
      assert.equal(e2eLegacyAfter?.startsAt.toISOString(), "2026-11-08T05:40:47.733Z");
      assert.equal(e2eLegacyAfter?.endsAt.toISOString(), "2026-12-06T05:40:47.733Z");

      throw new RollbackFixture();
    }).catch((error: unknown) => { if (!(error instanceof RollbackFixture)) throw error; });

    // Two first-onboarding requests for the same verified customer serialize
    // on the user row and can create only one Organization trial and slot.
    const concurrentOwnerEmail = `trial-onboard-race-${suffix}@example.test`;
    const [concurrentOwner] = await v2Db.insert(schema.users).values({ email: concurrentOwnerEmail, emailVerifiedAt: new Date() }).returning();
    const [concurrentIntent] = await v2Db.insert(schema.customerSignupIntents).values({
      email: concurrentOwnerEmail, locale: "en", expiresAt: new Date(Date.now() + 60_000), verifiedAt: new Date(),
    }).returning();
    const concurrentOnboardingInput = {
      authenticatedUserId: concurrentOwner.id, signupIntentId: concurrentIntent.id,
      organizationName: `Concurrent onboarding ${suffix}`, locationName: "First Location", timezone: "UTC",
    };
    const concurrentOnboarding = await Promise.all([
      completeOrdinaryCustomerOnboarding(concurrentOnboardingInput),
      completeOrdinaryCustomerOnboarding(concurrentOnboardingInput),
    ]);
    assert.deepEqual(concurrentOnboarding.map((row) => row.status).sort(), ["already_complete", "completed"]);
    const [concurrentOrganization] = await v2Db.select().from(organizations).where(eq(organizations.name, concurrentOnboardingInput.organizationName));
    assert(concurrentOrganization);
    assert.equal((await v2Db.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.organizationId, concurrentOrganization.id))).length, 1);
    assert.equal((await v2Db.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.organizationId, concurrentOrganization.id))).length, 1);

    // A real multi-connection race: every creation locks the same Organization
    // row; exactly four of five additional Locations consume the remaining slots.
    const [user] = await v2Db.insert(schema.users).values({ email: `trial-race-${suffix}@example.test`, emailVerifiedAt: new Date() }).returning();
    const created = await v2Db.transaction(async (tx) => {
      const result = await createCustomerWithFirstLocationInTransaction(tx, {
        organizationName: `Trial race ${suffix}`, contactEmail: null, locationName: "First", slug: `race-first-${suffix.slice(0, 12)}`, timezone: "UTC",
      }, { provisionBasicTrial: true });
      await tx.insert(organizationMembers).values({ organizationId: result.organization.id, userId: user.id, role: "owner" });
      return result;
    });
    const organization = created.organization;
    const raceAdds = await Promise.all(Array.from({ length: 5 }, (_, index) => createCustomerLocation({
      authenticatedUserId: user.id, organizationId: organization.id, name: `Concurrent ${index}`, timezone: "UTC",
    })));
    const raceSlots = await v2Db.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.organizationId, organization.id));
    assert.equal(raceSlots.length, 5);
    assert.equal(new Set(raceSlots.map((slot) => slot.slotNumber)).size, 5);
    assert.equal(new Set(raceSlots.map((slot) => slot.locationId)).size, 5);
    assert.equal(new Set(raceAdds.map((row) => row.id)).size, 5);
    assert.equal((await v2Db.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.organizationId, organization.id))).length, 1);

    // Slot allocations are intentionally append-only (DELETE is trigger-blocked).
    // This suite requires a disposable database that is discarded after the run.
    console.info("V2 Organization Basic Trial Runtime PASS: atomic/idempotent concurrent onboarding, immutable 28-day window, Locations 2–6, exact E2E date preservation, archived Location behavior, paid and Spaquatoria independence, Basic legacy suppression, Divnitsa compatibility, expiry, quota, and concurrent slot allocation. Committed test fixtures remain in the disposable database for teardown.");
  } finally {
    await v2Pool.end();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
