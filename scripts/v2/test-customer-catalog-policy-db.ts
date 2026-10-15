import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

class Rollback extends Error {}

async function main() {
  if (process.env.V2_CUSTOMER_CATALOG_TEST_ALLOW_DATABASE !== "1") {
    throw new Error("Set V2_CUSTOMER_CATALOG_TEST_ALLOW_DATABASE=1 to enable this rollback-only database test.");
  }
  const connectionString = process.env.V2_DATABASE_URL;
  if (!connectionString) throw new Error("V2_DATABASE_URL is required.");
  const url = new URL(connectionString);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname) ||
      decodeURIComponent(url.pathname) !== "/soundspa_v2" || decodeURIComponent(url.username) !== "soundspa_v2_test") {
    throw new Error("Refusing database test: expected local PostgreSQL database soundspa_v2 and role soundspa_v2_test.");
  }

  const [{ v2Db, v2Pool }, schema, { getCustomerCatalogProductPolicy }] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/queries/customerCatalogPolicy"),
  ]);
  const {
    commercialProductOrganizationAuthorizations, commercialProductChannels, commercialProducts,
    commercialPartnerBenefits, commercialPartners, commercialPaymentProviders,
    commercialRegistrationLinkGrants, commercialRegistrationLinkRedemptions,
    commercialRegistrationLinks, customerSignupIntents, locationCoreTrials,
    locationSubscriptions, locations, organizations, channels, users,
  } = schema;
  const { rows: identity } = await v2Pool.query<{ current_database: string; current_user: string; server_version_num: string }>(
    "SELECT current_database(), current_user, current_setting('server_version_num') AS server_version_num",
  );
  assert.equal(identity[0]?.current_database, "soundspa_v2");
  assert.equal(identity[0]?.current_user, "soundspa_v2_test");
  assert.equal(identity[0]?.server_version_num.slice(0, 2), "16", "only PostgreSQL 16 disposable test infrastructure is supported");
  const { rows: migrationRows } = await v2Pool.query<{ count: string; latest: string | null }>(
    'SELECT count(*)::text AS count, max(created_at)::text AS latest FROM "drizzle_v2"."__drizzle_migrations"',
  );
  assert.equal(migrationRows[0]?.count, "26", "disposable database must already have the complete migration chain");
  assert.equal(migrationRows[0]?.latest, "1792069806105", "migration 0025 must already be applied; this script never migrates");

  const suffix = randomUUID();
  try {
    await v2Db.transaction(async (tx) => {
      const [orgA] = await tx.insert(organizations).values({ name: "catalog-policy-a-" + suffix }).returning();
      const [orgB] = await tx.insert(organizations).values({ name: "catalog-policy-b-" + suffix }).returning();
      const [locationA] = await tx.insert(locations).values({ organizationId: orgA.id, name: "Location A", slug: "catalog-a-" + suffix, timezone: "UTC" }).returning();
      const [locationB] = await tx.insert(locations).values({ organizationId: orgA.id, name: "Location B", slug: "catalog-b-" + suffix, timezone: "UTC" }).returning();
      const [locationC] = await tx.insert(locations).values({ organizationId: orgB.id, name: "Location C", slug: "catalog-c-" + suffix, timezone: "UTC" }).returning();
      const [orgProduct] = await tx.insert(commercialProducts).values({ code: "catalog-org-" + suffix, name: "Organization assigned test", kind: "core", catalogVisibility: "assigned" }).returning();
      const [trialProduct, subscriptionProduct, benefitProduct, registrationProduct, redemptionProduct] = await tx.insert(commercialProducts).values([
        { code: "catalog-trial-" + suffix, name: "Location trial test", kind: "core", catalogVisibility: "assigned" },
        { code: "catalog-subscription-" + suffix, name: "Location subscription test", kind: "core", catalogVisibility: "assigned" },
        { code: "catalog-benefit-" + suffix, name: "Location benefit test", kind: "core", catalogVisibility: "assigned" },
        { code: "catalog-registration-" + suffix, name: "Location registration test", kind: "core", catalogVisibility: "assigned" },
        { code: "catalog-redemption-" + suffix, name: "Location redemption test", kind: "core", catalogVisibility: "assigned" },
      ]).returning();
      // Migrations intentionally do not seed customer catalog data; create the
      // channel fixture in this rollback-only transaction for a truly fresh DB.
      const [channel] = await tx.insert(channels).values({
        slug: "catalog-policy-" + suffix,
        displayName: "Catalog policy test channel",
        kind: "music",
        isPublished: true,
      }).returning();
      await tx.insert(commercialProductChannels).values([
        { productId: orgProduct.id, channelId: channel.id },
        { productId: trialProduct.id, channelId: channel.id },
      ]);
      await tx.insert(commercialProductOrganizationAuthorizations).values({
        organizationId: orgA.id, productId: orgProduct.id, grantSource: "operator",
        grantedByOperator: "catalog-policy-test", grantReason: "Isolated catalog scope test",
      });
      const now = new Date();
      await tx.insert(locationCoreTrials).values({
        locationId: locationA.id, productId: trialProduct.id, status: "expired",
        startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() - 1),
      });

      const [provider] = await tx.insert(commercialPaymentProviders).values({
        code: "catalog-test-" + suffix.slice(0, 8), displayName: "Catalog policy isolated test", isEnabled: false,
      }).returning();
      await tx.insert(locationSubscriptions).values({
        locationId: locationA.id, productId: subscriptionProduct.id, provider: provider.code,
        status: "expired", startsAt: new Date(now.getTime() - 86_400_000),
        currentPeriodEndsAt: new Date(now.getTime() - 1),
      });

      const [partner] = await tx.insert(commercialPartners).values({ code: "catalog-test-" + suffix, name: "Catalog policy isolated test partner" }).returning();
      await tx.insert(commercialPartnerBenefits).values({
        partnerId: partner.id, productId: benefitProduct.id, locationId: locationA.id,
        startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() - 1),
      });

      const [link] = await tx.insert(commercialRegistrationLinks).values({
        tokenHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        policyKey: "divnitsa", policyVersion: 1,
        policySnapshot: {
          policyKey: "divnitsa", policyVersion: 1, basicProductId: orgProduct.id,
          divnitsaProductId: registrationProduct.id, basicTrialDays: 30, divnitsaTrialDays: 30,
        },
        createdByOperator: "catalog-policy-test", creationReason: "Isolated catalog scope fixture",
      }).returning();
      const [intent] = await tx.insert(customerSignupIntents).values({
        registrationLinkId: link.id, expiresAt: new Date(now.getTime() + 86_400_000),
      }).returning();
      const [verifiedUser] = await tx.insert(users).values({
        email: `catalog-${suffix}@example.invalid`, emailVerifiedAt: now,
      }).returning();
      const [redemption] = await tx.insert(commercialRegistrationLinkRedemptions).values({
        registrationLinkId: link.id, signupIntentId: intent.id, verifiedUserId: verifiedUser.id,
        organizationId: orgA.id, firstLocationId: locationA.id, productId: registrationProduct.id,
      }).returning();
      await tx.insert(commercialRegistrationLinkGrants).values({
        redemptionId: redemption.id, organizationId: orgA.id, locationId: locationA.id,
        productId: registrationProduct.id, accessType: "trial", durationMonths: 1,
        startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() - 1),
      });

      // Legacy Divnitsa redemption records also establish product assignment;
      // exercise that source separately from the newer per-product grant row.
      const [legacyLink] = await tx.insert(commercialRegistrationLinks).values({
        tokenHash: suffix.replaceAll("-", "").padEnd(64, "1").slice(0, 64),
        policyKey: "divnitsa", policyVersion: 1,
        policySnapshot: {
          policyKey: "divnitsa", policyVersion: 1, basicProductId: orgProduct.id,
          divnitsaProductId: redemptionProduct.id, basicTrialDays: 30, divnitsaTrialDays: 30,
        },
        createdByOperator: "catalog-policy-test", creationReason: "Legacy redemption scope fixture",
      }).returning();
      const [legacyIntent] = await tx.insert(customerSignupIntents).values({
        registrationLinkId: legacyLink.id, expiresAt: new Date(now.getTime() + 86_400_000),
      }).returning();
      const [legacyUser] = await tx.insert(users).values({
        email: `catalog-legacy-${suffix}@example.invalid`, emailVerifiedAt: now,
      }).returning();
      await tx.insert(commercialRegistrationLinkRedemptions).values({
        registrationLinkId: legacyLink.id, signupIntentId: legacyIntent.id, verifiedUserId: legacyUser.id,
        organizationId: orgA.id, firstLocationId: locationA.id, productId: redemptionProduct.id,
      });

      const policyA = await getCustomerCatalogProductPolicy(locationA.id, tx);
      const policyB = await getCustomerCatalogProductPolicy(locationB.id, tx);
      const policyC = await getCustomerCatalogProductPolicy(locationC.id, tx);
      assert.ok(policyA.assignedProductIds.has(orgProduct.id));
      assert.ok(policyB.assignedProductIds.has(orgProduct.id), "Organization authorization applies to all Locations of its Organization");
      assert.ok(!policyC.assignedProductIds.has(orgProduct.id), "another Organization cannot inherit the authorization");
      for (const [product, source] of [
        [trialProduct, "trial"],
        [subscriptionProduct, "subscription"],
        [benefitProduct, "Partner Benefit"],
        [registrationProduct, "Registration Link grant"],
        [redemptionProduct, "legacy Registration Link redemption"],
      ] as const) {
        assert.ok(policyA.assignedProductIds.has(product.id), `Location A includes its ${source} history`);
        assert.ok(!policyB.assignedProductIds.has(product.id), `${source} history does not leak to Location B in the same Organization`);
        assert.ok(!policyC.assignedProductIds.has(product.id), `${source} history does not leak to another Organization`);
      }

      await tx.update(commercialProductOrganizationAuthorizations).set({ revokedAt: new Date(now.getTime() + 60_000), revokedByOperator: "catalog-policy-test", revokeReason: "Scope test complete" })
        .where(eq(commercialProductOrganizationAuthorizations.organizationId, orgA.id));
      const afterRevoke = await getCustomerCatalogProductPolicy(locationB.id, tx);
      assert.ok(afterRevoke.assignedProductIds.has(orgProduct.id), "previous Organization authorization remains catalog history after revocation");
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  console.info("Customer Catalog policy PostgreSQL integration PASS: Organization authorization scope; Location trial, subscription, Partner Benefit, and Registration Link grant scope; cross-tenant isolation; expired assignment history; revocation history; rollback cleanup.");
  await v2Pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
