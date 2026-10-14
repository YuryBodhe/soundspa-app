import assert from "node:assert/strict";
import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

class Rollback extends Error {}

function assertDisposableLocalTarget(value: string): URL {
  const target = new URL(value);
  if (process.env.V2_BILLING_ORDER_TEST_ALLOW_DATABASE !== "1" ||
      !new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) ||
      decodeURIComponent(target.pathname) !== "/soundspa_v2" ||
      ["soundspa_v2", "postgres", "root"].includes(decodeURIComponent(target.username))) {
    throw new Error("Refusing Product Visibility test: require explicit opt-in and a dedicated loopback soundspa_v2 database role.");
  }
  return target;
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("V2_DATABASE_URL must point to a disposable local PostgreSQL database.");
  const target = assertDisposableLocalTarget(databaseUrl);
  process.env.V2_DEPLOYMENT_ENV = "staging";
  process.env.V2_FAKE_PROVIDER_ENABLED = "1";
  process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.bodhemusic.com";
  process.env.V2_FAKE_PROVIDER_SECRET = "rollback-only-product-visibility-test-secret-32-bytes";

  const [{ v2Db, v2Pool }, schema, billing, customerBilling, fakeOrder, fakeSingle, orderRead, access] = await Promise.all([
    import("../../db/v2/client"), import("../../db/v2/schema"), import("../../db/v2/services/billingOrders"),
    import("../../db/v2/services/customerBilling"),
    import("../../db/v2/services/fakeBillingOrderProvider"), import("../../db/v2/services/fakePaymentProvider"),
    import("../../db/v2/services/billingOrderRead"), import("../../db/v2/queries/commercialAccess"),
  ]);
  let assertions = 0;
  const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertions += 1; };
  const rejectsWithCode = async (operation: Promise<unknown>, code: string) => {
    await assert.rejects(operation, (error: unknown) => error && typeof error === "object" && "code" in error && error.code === code);
    assertions += 1;
  };
  try {
    const identityResult = await v2Pool.query<{
      database: string; role: string; address: string | null; version: string; migrations: number; latest: string;
    }>("SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, current_setting('server_version_num') AS version, (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations, (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest");
    const identity = identityResult.rows[0];
    const address = identity?.address?.split("/")[0] ?? "";
    if (!identity || identity.database !== "soundspa_v2" || identity.role !== decodeURIComponent(target.username) ||
        identity.role === "soundspa_v2" || identity.role === "postgres" || !identity.version.startsWith("16") ||
        isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) ||
        identity.migrations !== 20 || identity.latest !== "1791986317531") {
      throw new Error("Database identity did not match the expected isolated PostgreSQL 16 test instance at migration 0019.");
    }
    const clean = await v2Pool.query<{ count: string }>("SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM location_channel_grants) + (SELECT count(*) FROM gift_access_invitations) + (SELECT count(*) FROM organization_channel_gift_grants) AS count");
    if (clean.rows[0]?.count !== "0") throw new Error("Disposable Product Visibility database must start without customer or billing records.");

    try {
      await v2Db.transaction(async (tx) => {
        const suffix = randomUUID();
        const now = new Date("2026-10-14T10:00:00.000Z");
        const [org] = await tx.insert(schema.organizations).values({ name: `visibility-${suffix}` }).returning();
        const [owner] = await tx.insert(schema.users).values({ email: `visibility-${suffix}@example.test`, emailVerifiedAt: now }).returning();
        await tx.insert(schema.organizationMembers).values({ organizationId: org.id, userId: owner.id, role: "owner" });
        const [outsideOrg] = await tx.insert(schema.organizations).values({ name: `visibility-outside-${suffix}` }).returning();
        const [outsideOwner] = await tx.insert(schema.users).values({ email: `visibility-outside-${suffix}@example.test`, emailVerifiedAt: now }).returning();
        await tx.insert(schema.organizationMembers).values({ organizationId: outsideOrg.id, userId: outsideOwner.id, role: "owner" });
        const locations = await tx.insert(schema.locations).values([1, 2, 3, 4].map((n) => ({
          organizationId: org.id, name: `Visibility ${n}`, slug: `visibility-${suffix.slice(0, 8)}-${n}`,
          timezone: "Europe/Moscow", marketCode: "RU",
        }))).returning();
        const [outsideLocation] = await tx.insert(schema.locations).values({ organizationId: outsideOrg.id,
          name: "Outside", slug: `visibility-outside-${suffix.slice(0, 8)}`, timezone: "Europe/Moscow", marketCode: "RU" }).returning();
        const [channel] = await tx.insert(schema.channels).values({
          slug: `visibility-${suffix.slice(0, 12)}`, displayName: "Visibility channel", kind: "music", isPublished: true,
        }).returning();
        const products = await tx.insert(schema.commercialProducts).values([
          { code: `visibility-public-${suffix}`, name: "Visibility public", kind: "core", priceMinor: 108000, currency: "RUB" },
          { code: `visibility-private-${suffix}`, name: "Visibility private", kind: "partner", visibility: "private" },
          { code: `visibility-disabled-${suffix}`, name: "Visibility disabled", kind: "core", visibility: "disabled" },
          { code: `visibility-inactive-${suffix}`, name: "Visibility inactive", kind: "core", isActive: false },
        ]).returning();
        const [provider] = await tx.insert(schema.commercialPaymentProviders).values({ code: "fake-staging", displayName: "Staging Fake Provider", isEnabled: true }).returning();
        const routes = await tx.insert(schema.commercialPaymentRoutes).values(products.map((product) => ({
          marketCode: "RU", productId: product.id, providerCode: provider.code, externalReference: `visibility:${product.code}`,
        }))).returning();
        await tx.insert(schema.commercialProductChannels).values({ productId: products[1].id, channelId: channel.id });
        const [partner] = await tx.insert(schema.commercialPartners).values({ code: `visibility-partner-${suffix}`, name: "Visibility partner", isActive: true }).returning();
        await tx.insert(schema.commercialPartnerBenefits).values({ partnerId: partner.id, productId: products[1].id,
          locationId: locations[2].id, startsAt: new Date(now.getTime() - 1000), endsAt: null });
        await tx.insert(schema.locationChannelGrants).values({ locationId: locations[1].id, channelId: channel.id,
          startsAt: new Date(now.getTime() - 1000), endsAt: null });
        const giftRedeemedAt = new Date(now.getTime() - 1000);
        const [giftInvitation] = await tx.insert(schema.giftAccessInvitations).values({
          tokenHash: createHash("sha256").update(`visibility-gift-${suffix}`).digest("hex"),
          channelId: channel.id, duration: "3_months", durationMonths: 3, createdByOperator: "integration-test-operator",
          redeemedAt: giftRedeemedAt, redeemedOrganizationId: org.id, redeemedByUserId: owner.id,
        }).returning();
        await tx.insert(schema.organizationChannelGiftGrants).values({
          invitationId: giftInvitation.id, organizationId: org.id, channelId: channel.id, redeemedByUserId: owner.id,
          duration: "3_months", durationMonths: 3, redeemedAt: giftRedeemedAt, startsAt: giftRedeemedAt,
          endsAt: new Date(now.getTime() + 90 * 86400000), billingAnchorDay: 14, billingAnchorIsEndOfMonth: false,
        });
        await tx.insert(schema.locationCoreTrials).values({ locationId: locations[0].id, productId: products[1].id,
          status: "active", startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 86400000) });
        await tx.insert(schema.locationSubscriptions).values({ locationId: locations[1].id, productId: products[1].id,
          provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 1000),
          currentPeriodEndsAt: new Date(now.getTime() + 30 * 86400000), billingAnchorDay: 14, billingAnchorIsEndOfMonth: false });
        const [authorization] = await tx.insert(schema.commercialProductOrganizationAuthorizations).values({
          organizationId: org.id, productId: products[1].id, grantedAt: now,
          grantedByOperator: "integration-test-operator", grantReason: "Product visibility integration test",
        }).returning();

        const beforeBenefit = await tx.select().from(schema.commercialPartnerBenefits);
        const beforeTrial = await tx.select().from(schema.locationCoreTrials);
        const beforeSubscription = await tx.select().from(schema.locationSubscriptions);
        const beforeAdminGrants = await tx.select().from(schema.locationChannelGrants);
        const beforeGiftInvitations = await tx.select().from(schema.giftAccessInvitations);
        const beforeGiftGrants = await tx.select().from(schema.organizationChannelGiftGrants);
        const beforeOrders = await tx.select().from(schema.commercialBillingOrders);
        const beforePayments = await tx.select().from(schema.commercialPayments);
        const ownerView = await customerBilling.listCustomerBilling(owner.id, now, tx);
        const publicCard = ownerView.locations.find((item) => item.id === locations[3].id)?.products.find((item) => item.productId === products[0].id);
        check(publicCard?.purchaseEligible === true, "new Products default to public and remain purchasable without an Organization grant");
        const privateCard = ownerView.locations.find((item) => item.id === locations[0].id)?.products.find((item) => item.productId === products[1].id);
        check(privateCard?.purchaseEligible === true, "active Organization grant makes a private Product purchasable in Account");
        check(!ownerView.locations.find((item) => item.id === locations[0].id)?.products.some((item) => item.productId === products[2].id), "disabled Product without existing access is not listed as purchasable");
        check(!ownerView.locations.find((item) => item.id === locations[0].id)?.products.some((item) => item.productId === products[3].id), "inactive Product remains unavailable");
        const outsideView = await customerBilling.listCustomerBilling(outsideOwner.id, now, tx);
        check(!outsideView.locations.find((item) => item.id === outsideLocation.id)?.products.some((item) => item.productId === products[1].id), "private Product is not exposed to another Organization without entitlement or grant");
        assert.deepEqual(await tx.select().from(schema.commercialBillingOrders), beforeOrders, "loading Billing data does not create orders");
        assert.deepEqual(await tx.select().from(schema.commercialPayments), beforePayments, "loading Billing data does not create payments");
        assert.deepEqual(await tx.select().from(schema.locationCoreTrials), beforeTrial, "loading Billing data does not create or alter trials");
        assert.deepEqual(await tx.select().from(schema.locationSubscriptions), beforeSubscription, "loading Billing data does not create or alter subscriptions");
        assertions += 4;

        const privateRequest = { authenticatedUserId: owner.id, organizationId: org.id,
          lines: [{ locationId: locations[3].id, productId: products[1].id, durationMonths: 1 }] };
        const publicPreview = await billing.previewPrepaidBillingOrder({ ...privateRequest,
          lines: [{ ...privateRequest.lines[0], productId: products[0].id }] }, { db: tx, now, env: process.env });
        check(publicPreview.lines[0]?.productId === products[0].id, "public Product can be quoted without explicit Organization authorization");
        const preview = await billing.previewPrepaidBillingOrder(privateRequest, { db: tx, now, env: process.env });
        check(preview.lines[0]?.productId === products[1].id, "authorized private Product can be quoted");
        await rejectsWithCode(billing.previewPrepaidBillingOrder({ authenticatedUserId: outsideOwner.id, organizationId: outsideOrg.id,
          lines: [{ locationId: outsideLocation.id, productId: products[1].id, durationMonths: 1 }] }, { db: tx, now, env: process.env }), "product_unavailable");
        await rejectsWithCode(billing.createPrepaidBillingOrder({ authenticatedUserId: outsideOwner.id, organizationId: outsideOrg.id,
          lines: [{ locationId: outsideLocation.id, productId: products[1].id, durationMonths: 1 }] }, { db: tx, now, env: process.env }), "product_unavailable");
        await rejectsWithCode(billing.createPrepaidBillingOrder({ ...privateRequest,
          lines: [{ ...privateRequest.lines[0], productId: products[2].id }] }, { db: tx, now, env: process.env }), "product_unavailable");
        await rejectsWithCode(billing.previewPrepaidBillingOrder({ ...privateRequest,
          lines: [{ ...privateRequest.lines[0], productId: products[2].id }] }, { db: tx, now, env: process.env }), "product_unavailable");
        await rejectsWithCode(fakeSingle.createFakeProviderCheckout({ authenticatedUserId: outsideOwner.id,
          locationId: outsideLocation.id, productId: products[1].id, routeId: routes[1].id }, now, tx), "product_unavailable");
        await rejectsWithCode(fakeSingle.createFakeProviderCheckout({ authenticatedUserId: owner.id,
          locationId: locations[0].id, productId: products[2].id, routeId: routes[2].id }, now, tx), "product_unavailable");
        await rejectsWithCode(fakeSingle.createFakeProviderCheckout({ authenticatedUserId: owner.id,
          locationId: locations[0].id, productId: products[3].id, routeId: routes[3].id }, now, tx), "product_unavailable");

        const pendingAtLocationA = await billing.createPrepaidBillingOrder({
          authenticatedUserId: owner.id, organizationId: org.id,
          lines: [{ locationId: locations[0].id, productId: products[0].id, durationMonths: 1 }],
        }, { db: tx, now, env: process.env });
        await fakeOrder.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id,
          billingOrderId: pendingAtLocationA.id }, now, tx);
        const afterOtherLocationPending = await customerBilling.listCustomerBilling(owner.id, now, tx);
        const publicProductAtLocationB = afterOtherLocationPending.locations.find((item) => item.id === locations[1].id)
          ?.products.find((item) => item.productId === products[0].id);
        check(publicProductAtLocationB?.purchaseEligible === true && publicProductAtLocationB.routes.length > 0,
          "a pending checkout for Location A does not hide the same public Product from Location B");

        // Revoke before the draft reaches pending: first checkout must recheck.
        const draftBeforeRevoke = await billing.createPrepaidBillingOrder(privateRequest, { db: tx, now, env: process.env });
        await tx.update(schema.commercialProductOrganizationAuthorizations).set({ revokedAt: now,
          revokedByOperator: "integration-test-operator", revokeReason: "Revocation behavior test" }).where(eq(schema.commercialProductOrganizationAuthorizations.id, authorization.id));
        await rejectsWithCode(fakeOrder.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id,
          billingOrderId: draftBeforeRevoke.id }, now, tx), "product_unavailable");
        const paymentsAfterRejectedDraft = await tx.select({ id: schema.commercialPayments.id, billingOrderId: schema.commercialPayments.billingOrderId }).from(schema.commercialPayments);
        check(paymentsAfterRejectedDraft.length === 1 && paymentsAfterRejectedDraft[0]?.billingOrderId === pendingAtLocationA.id,
          "revoked authorization prevents a draft payment without disturbing another Location's pending checkout");

        // A new authorization allows a pending checkout. Revocation and even a
        // subsequent visibility change do not invalidate that payable order.
        const [secondAuthorization] = await tx.insert(schema.commercialProductOrganizationAuthorizations).values({
          organizationId: org.id, productId: products[1].id, grantedAt: new Date(now.getTime() + 1000),
          grantedByOperator: "integration-test-operator", grantReason: "Regrant for pending checkout test",
        }).returning();
        const singleCheckout = await fakeSingle.createFakeProviderCheckout({ authenticatedUserId: owner.id,
          locationId: locations[0].id, productId: products[1].id, routeId: routes[1].id }, new Date(now.getTime() + 1000), tx);
        check(Boolean(singleCheckout.confirmationToken), "authorized private Product can start a direct single-Location checkout");
        const pendingDraft = await billing.createPrepaidBillingOrder(privateRequest, { db: tx, now: new Date(now.getTime() + 1000), env: process.env });
        const checkout = await fakeOrder.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id,
          billingOrderId: pendingDraft.id }, new Date(now.getTime() + 1000), tx);
        await tx.update(schema.commercialProductOrganizationAuthorizations).set({ revokedAt: new Date(now.getTime() + 1500),
          revokedByOperator: "integration-test-operator", revokeReason: "Pending order remains payable test" })
          .where(eq(schema.commercialProductOrganizationAuthorizations.id, secondAuthorization.id));
        await tx.update(schema.commercialProducts).set({ visibility: "disabled" }).where(eq(schema.commercialProducts.id, products[1].id));
        const resumed = await fakeOrder.getFakeProviderBillingOrderCheckoutLink({ authenticatedUserId: owner.id,
          billingOrderId: pendingDraft.id }, new Date(now.getTime() + 2000), tx);
        check(resumed.checkoutId === checkout.checkoutId, "already-pending checkout remains resumable after grant revocation and visibility change");
        const settlement = await fakeOrder.confirmFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id,
          confirmationToken: checkout.confirmationToken }, new Date(now.getTime() + 3000), tx);
        check(settlement.duplicate === false, "late successful payment settles after authorization revocation");
        const singleSettlement = await fakeSingle.confirmFakeProviderCheckout({ authenticatedUserId: owner.id,
          confirmationToken: singleCheckout.confirmationToken }, new Date(now.getTime() + 3000), tx);
        check(singleSettlement.duplicate === false, "single-Location pending payment still settles after authorization revocation");
        const order = await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: pendingDraft.id }, now, tx);
        check(order.status === "paid", "historical order remains readable after Product is disabled");

        const afterVisibilityChange = await customerBilling.listCustomerBilling(owner.id, new Date(now.getTime() + 3000), tx);
        const retained = afterVisibilityChange.locations.find((item) => item.id === locations[3].id)?.products.find((item) => item.productId === products[1].id);
        check(retained?.status === "subscription" && retained.purchaseEligible === false, "existing paid access remains visible but is no longer purchasable");
        const commercialAccess = await access.resolveCommercialProductAccess(locations[0].id, new Date(now.getTime() + 3000), tx);
        check(commercialAccess.get(channel.id)?.has("trial"), "visibility does not remove existing trial channel access");
        const paidAccess = await access.resolveCommercialProductAccess(locations[3].id, new Date(now.getTime() + 3000), tx);
        check(paidAccess.get(channel.id)?.has("subscription"), "visibility does not remove newly settled paid channel access");
        const benefitAccess = await access.resolveCommercialProductAccess(locations[2].id, new Date(now.getTime() + 3000), tx);
        check(benefitAccess.get(channel.id)?.has("partner_benefit"), "visibility does not remove Partner Benefit channel access");
        assert.deepEqual(await tx.select().from(schema.commercialPartnerBenefits), beforeBenefit, "Partner Benefits remain unchanged");
        assert.deepEqual(await tx.select().from(schema.locationCoreTrials), beforeTrial, "existing trials remain unchanged");
        assert.deepEqual(await tx.select().from(schema.locationSubscriptions).where(inArray(schema.locationSubscriptions.id, beforeSubscription.map((row) => row.id))), beforeSubscription,
          "pre-existing subscription periods are not rewritten by visibility changes");
        assert.deepEqual(await tx.select().from(schema.locationChannelGrants), beforeAdminGrants, "Location Admin Grants remain unchanged");
        assert.deepEqual(await tx.select().from(schema.giftAccessInvitations), beforeGiftInvitations, "Gift Access invitation history remains unchanged");
        assert.deepEqual(await tx.select().from(schema.organizationChannelGiftGrants), beforeGiftGrants, "Gift Access grants remain unchanged");
        const authorizationHistory = await tx.select().from(schema.commercialProductOrganizationAuthorizations)
          .where(eq(schema.commercialProductOrganizationAuthorizations.organizationId, org.id));
        check(authorizationHistory.length === 2 && authorizationHistory.filter((row) => row.revokedAt).length === 2,
          "grant and revocation history is preserved as auditable records");
        assertions += 6;

        throw new Rollback("rollback-only");
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    const leftovers = await v2Pool.query<{ count: string }>("SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM location_channel_grants) + (SELECT count(*) FROM gift_access_invitations) + (SELECT count(*) FROM organization_channel_gift_grants) AS count");
    assert.equal(leftovers.rows[0]?.count, "0", "all Product Visibility fixtures roll back cleanly");
    assertions += 1;
    console.info(JSON.stringify({ postgres: 16, migrations: 20, assertions, result: "PASS" }));
  } finally {
    await v2Pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Product Visibility integration failed.");
  process.exitCode = 1;
});
