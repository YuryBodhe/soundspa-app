import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";

class Rollback extends Error {}

function assertDisposableLocalTarget(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  if (process.env.V2_BILLING_ORDER_TEST_ALLOW_DATABASE !== "1" ||
      !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) ||
      decodeURIComponent(parsed.pathname) !== "/soundspa_v2") {
    throw new Error("Refusing billing-order integration test: require explicit opt-in and a loopback soundspa_v2 database.");
  }
  return parsed;
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("V2_DATABASE_URL must point to a disposable local PostgreSQL database.");
  const target = assertDisposableLocalTarget(databaseUrl);

  process.env.V2_DEPLOYMENT_ENV = "staging";
  process.env.V2_FAKE_PROVIDER_ENABLED = "1";
  process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.bodhemusic.com";
  process.env.V2_FAKE_PROVIDER_SECRET = "rollback-only-billing-order-test-secret-32-bytes";
  process.env.V2_ADMIN_USERNAME = "billing-integration-operator";
  process.env.V2_ADMIN_PASSWORD = "isolated-manual-billing-password-not-for-deployment";
  const manualOperatorAuthorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;

  const [{ v2Db, v2Pool }, schema, service, permissionService, customerBilling, aggregateFake, singleFake, orderRead, orderLifecycle, paymentLifecycle, billingOrderModel, manualBillingAdmin] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/billingOrders"),
    import("../../db/v2/services/locationBillingPermissions"),
    import("../../db/v2/services/customerBilling"),
    import("../../db/v2/services/fakeBillingOrderProvider"),
    import("../../db/v2/services/fakePaymentProvider"),
    import("../../db/v2/services/billingOrderRead"),
    import("../../db/v2/services/billingOrderLifecycle"),
    import("../../db/v2/services/paymentLifecycle"),
    import("../../db/v2/services/billingOrderModel"),
    import("../../db/v2/services/manualBillingAdmin"),
  ]);
  const assertAggregateError = async (operation: Promise<unknown>, code: string) => {
    await assert.rejects(operation, (error: unknown) => error instanceof aggregateFake.FakeBillingOrderError && error.code === code);
  };
  try {
    const identity = await v2Pool.query<{ database: string; role: string; address: string | null; port: number; migrationCount: string; latestMigration: string }>(
      "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port, (SELECT count(*) FROM drizzle_v2.__drizzle_migrations)::text AS \"migrationCount\", (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS \"latestMigration\"",
    );
    const dbIdentity = identity.rows[0];
    const address = dbIdentity?.address?.split("/")[0] ?? "";
    const expectedLocalRole = decodeURIComponent(target.username);
    if (!dbIdentity || dbIdentity.database !== "soundspa_v2" ||
        !new Set(["127.0.0.1", "::1"]).has(address) || isIP(address) === 0 ||
        expectedLocalRole !== "soundspa_v2_test" || dbIdentity.role !== "soundspa_v2_test" ||
        Number(dbIdentity.migrationCount) !== 31 || dbIdentity.latestMigration !== "1793202149431") {
      throw new Error("Database is not the expected disposable local database at migration 0030.");
    }
    const baseline = await v2Pool.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM location_billing_permissions) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) + (SELECT count(*) FROM commercial_product_visibility_events) + (SELECT count(*) FROM commercial_payment_providers WHERE code <> 'manual-bank-transfer') + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_payment_route_events) + (SELECT count(*) FROM commercial_billing_resets) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_billing_order_lines) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_events) + (SELECT count(*) FROM commercial_payment_allocations) + (SELECT count(*) FROM gift_access_invitations) + (SELECT count(*) FROM organization_channel_gift_grants) AS count",
    );
    if (baseline.rows[0]?.count !== "0") throw new Error("Disposable integration database must contain no customer or commercial fixtures before the test.");

    let assertionCount = 0;
    let fixtureOrganizationId: string | null = null;
    try {
      await v2Db.transaction(async (tx) => {
        const suffix = randomUUID();
        const now = new Date("2026-10-08T10:00:00.000Z");
        const [organization] = await tx.insert(schema.organizations).values({ name: `billing-order-${suffix}` }).returning();
        fixtureOrganizationId = organization.id;
        const [owner] = await tx.insert(schema.users).values({
          email: `billing-order-${suffix}@example.test`, emailVerifiedAt: now,
        }).returning();
        const [manager] = await tx.insert(schema.users).values({
          email: `billing-order-manager-${suffix}@example.test`, emailVerifiedAt: now,
        }).returning();
        const [admin] = await tx.insert(schema.users).values({
          email: `billing-order-admin-${suffix}@example.test`, emailVerifiedAt: now,
        }).returning();
        await tx.insert(schema.organizationMembers).values([
          { organizationId: organization.id, userId: owner.id, role: "owner" },
          { organizationId: organization.id, userId: manager.id, role: "manager" },
          { organizationId: organization.id, userId: admin.id, role: "admin" },
        ]);

        const locations = await tx.insert(schema.locations).values([1, 2, 3, 4, 5, 6].map((number) => ({
          organizationId: organization.id,
          name: `Billing order ${number}`,
          slug: `billing-order-${suffix.slice(0, 8)}-${number}`,
          timezone: "Europe/Moscow",
          marketCode: number <= 4 ? "RU" : null,
        }))).returning();
        const [outsideOrganization] = await tx.insert(schema.organizations).values({ name: `billing-order-outsider-${suffix}` }).returning();
        const [outsideLocation] = await tx.insert(schema.locations).values({
          organizationId: outsideOrganization.id,
          name: "Outside organization",
          slug: `billing-order-outside-${suffix.slice(0, 8)}`,
          timezone: "Europe/Moscow",
          marketCode: "RU",
        }).returning();

        const products = await tx.insert(schema.commercialProducts).values([
          { code: `billing-order-basic-${suffix}`, name: "Billing Basic", kind: "core", priceMinor: 108_000, currency: "RUB", billingIntervalMonths: 1 },
          { code: `billing-order-partner-${suffix}`, name: "Billing Partner", kind: "partner", priceMinor: 150_000, currency: "RUB", billingIntervalMonths: 1 },
          { code: `billing-order-inactive-${suffix}`, name: "Inactive Billing Product", kind: "core", priceMinor: 1, currency: "USD", isActive: false },
        ]).returning();
        const [provider] = await tx.insert(schema.commercialPaymentProviders).values({
          code: "fake-staging", displayName: "Staging Fake Provider", isEnabled: true,
        }).returning();
        const routes = await tx.insert(schema.commercialPaymentRoutes).values(products.map((product) => ({
          marketCode: "RU", productId: product.id, providerCode: provider.code,
          externalReference: `billing-order:${product.code}`,
        }))).returning();
        const [manualProvider] = await tx.select({ code: schema.commercialPaymentProviders.code })
          .from(schema.commercialPaymentProviders).where(eq(schema.commercialPaymentProviders.code, "manual-bank-transfer")).limit(1);
        assert.ok(manualProvider, "migration provisions the explicit manual bank-transfer provider");
        await tx.insert(schema.commercialPaymentRoutes).values(products.slice(0, 2).map((product) => ({
          marketCode: "RU", productId: product.id, providerCode: manualProvider.code,
          externalReference: `manual-bank-transfer:${product.code}`,
        })));

        // A currently paid period must be extended from its existing end and
        // original month-end anchor, while the other lines start at order time.
        const [existingSubscription] = await tx.insert(schema.locationSubscriptions).values({
          locationId: locations[0].id,
          productId: products[0].id,
          provider: provider.code,
          status: "active",
          startsAt: new Date("2026-08-31T10:00:00.000Z"),
          currentPeriodEndsAt: new Date("2026-10-31T10:00:00.000Z"),
          billingAnchorDay: 31,
          billingAnchorIsEndOfMonth: true,
        }).returning();
        await tx.insert(schema.locationSubscriptions).values({
          locationId: locations[0].id,
          productId: products[1].id,
          provider: provider.code,
          status: "active",
          startsAt: new Date("2026-09-01T10:00:00.000Z"),
          currentPeriodEndsAt: null,
        });
        const [trialLocationTrial] = await tx.insert(schema.locationCoreTrials).values({
          locationId: locations[1].id, productId: products[0].id, status: "active",
          startsAt: new Date("2026-10-01T10:00:00.000Z"), endsAt: new Date("2026-11-08T10:00:00.000Z"),
        }).returning();

        const beforeSubscriptions = await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions);
        const beforeTrials = await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials);
        const beforeBenefits = await tx.select({ id: schema.commercialPartnerBenefits.id }).from(schema.commercialPartnerBenefits);
        const beforeAdminGrants = await tx.select({ id: schema.locationChannelGrants.id, enabled: schema.locationChannelGrants.enabled,
          startsAt: schema.locationChannelGrants.startsAt, endsAt: schema.locationChannelGrants.endsAt, updatedAt: schema.locationChannelGrants.updatedAt,
        }).from(schema.locationChannelGrants);
        const input = {
          authenticatedUserId: owner.id,
          organizationId: organization.id,
          lines: [
            { locationId: locations[0].id, productId: products[0].id, durationMonths: 1 },
            { locationId: locations[1].id, productId: products[0].id, durationMonths: 2 },
            { locationId: locations[2].id, productId: products[1].id, durationMonths: 6 },
            { locationId: locations[3].id, productId: products[1].id, durationMonths: 12 },
          ],
        };
        const grant = await permissionService.grantLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        assert.equal(grant.granted, true, "owner can grant one manager one Location's billing authority");
        const repeatedGrant = await permissionService.grantLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        assert.equal(repeatedGrant.granted, false, "permission grants are idempotent");
        await assert.rejects(permissionService.grantLocationBillingPermission({
          authenticatedUserId: admin.id, locationId: locations[1].id, managerUserId: manager.id,
        }, tx), (error: unknown) => error instanceof permissionService.LocationBillingAuthorizationError && error.code === "not_authorized",
        "granting delegation must not silently expand the admin role");
        const managerOrder = await service.createPrepaidBillingOrder({
          ...input, authenticatedUserId: manager.id, lines: [input.lines[0]],
        }, { db: tx, now, env: process.env });
        assert.equal(managerOrder.lines[0].locationId, locations[0].id);
        const billingRowsBeforeLoad = {
          trials: await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials),
          subscriptions: await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions),
          orders: await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders),
          payments: await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments),
        };
        const initialOwnerBillingView = await customerBilling.listCustomerBilling(owner.id, now, tx);
        for (const location of [locations[4], locations[5]]) {
          const locationProducts = initialOwnerBillingView.locations.find((row) => row.id === location.id)?.products ?? [];
          const product = locationProducts
            .find((row) => row.productId === products[0].id);
          assert.equal(product?.status, "available", "an active catalog product is purchasable without a prior entitlement");
          assert.deepEqual(product?.routes, [], "an unset market has no resolved payment route yet");
          assert.equal(locationProducts.some((row) => row.productId === products[2].id), false, "inactive catalog products remain unavailable");
        }
        assert.ok(initialOwnerBillingView.supportedMarkets.includes("RU"), "the Wizard can offer configured RU even when a new Location has no saved market");
        assert.deepEqual(await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials), billingRowsBeforeLoad.trials,
          "loading Billing does not create trials");
        assert.deepEqual(await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions), billingRowsBeforeLoad.subscriptions,
          "loading Billing does not create subscriptions or entitlements");
        assert.deepEqual(await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders), billingRowsBeforeLoad.orders,
          "loading Billing does not create orders");
        assert.deepEqual(await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments), billingRowsBeforeLoad.payments,
          "loading Billing does not create payments");
        assertionCount += 11;
        const managerBillingView = await customerBilling.listCustomerBilling(manager.id, now, tx);
        assert.deepEqual(managerBillingView.locations.map((location) => location.id), [locations[0].id],
          "billing view exposes only explicitly delegated Locations to a manager");
        await assert.rejects(service.createPrepaidBillingOrder({
          ...input, authenticatedUserId: manager.id, lines: [input.lines[1]],
        }, { db: tx, now, env: process.env }),
        (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized");
        const draftsBeforeMixedAttempt = await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders);
        await assert.rejects(service.createPrepaidBillingOrder({
          ...input, authenticatedUserId: manager.id, lines: [input.lines[0], input.lines[1]],
        }, { db: tx, now, env: process.env }),
        (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized");
        assert.equal((await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders)).length,
          draftsBeforeMixedAttempt.length, "mixed authorized/unauthorized order creates no partial draft");
        const adminOrder = await service.createPrepaidBillingOrder({
          ...input, authenticatedUserId: admin.id, lines: [input.lines[1]],
        }, { db: tx, now, env: process.env });
        assert.equal(adminOrder.lines[0].locationId, locations[1].id, "existing admin billing authority remains intact");
        const revoked = await permissionService.revokeLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        assert.equal(revoked.revoked, true);
        const repeatedRevoke = await permissionService.revokeLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        assert.equal(repeatedRevoke.revoked, false, "permission revocation is idempotent");
        await assert.rejects(service.createPrepaidBillingOrder({
          ...input, authenticatedUserId: manager.id, lines: [input.lines[0]],
        }, { db: tx, now, env: process.env }),
        (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized",
        "revoked manager permission must be effective immediately");
        assert.deepEqual((await customerBilling.listCustomerBilling(manager.id, now, tx)).locations, [],
          "revoked manager permission removes the Location from billing view");
        await assertAggregateError(aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: manager.id, billingOrderId: managerOrder.id,
        }, now, tx), "not_authorized");
        await assert.rejects(permissionService.grantLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: outsideLocation.id, managerUserId: manager.id,
        }, tx), (error: unknown) => error instanceof permissionService.LocationBillingAuthorizationError && error.code === "not_authorized",
        "a grant cannot cross the owner's Organization boundary");
        await assert.rejects(service.createPrepaidBillingOrder({
          ...input, lines: [{ locationId: outsideLocation.id, productId: products[0].id, durationMonths: 1 }],
        }, { db: tx, now, env: process.env }),
        (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized",
        "an order cannot cross into another Organization");
        assertionCount += 14;

        const orderCountBeforePreview = await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders);
        const preview = await service.previewPrepaidBillingOrder(input, { db: tx, now, env: process.env });
        assert.equal(preview.organization.id, organization.id);
        assert.equal(preview.totalAmountMinor, "3024000");
        assert.deepEqual(preview.lines.map((line) => line.amountMinor), ["108000", "216000", "900000", "1800000"]);
        assert.equal(preview.quoteValidity.binding, false);
        assert.equal(preview.quoteValidity.revalidatedAtOrderCreation, true);
        assert.equal((await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders)).length,
          orderCountBeforePreview.length, "quote preview creates no order, payment, or entitlement rows");
        assertionCount += 6;

        const order = await service.createPrepaidBillingOrder(input, { db: tx, now, env: process.env });
        assert.equal(preview.totalAmountMinor, order.totalAmountMinor, "preview and persisted order use the same trusted pricing planner");
        assert.deepEqual(preview.lines.map((line) => line.amountMinor), order.lines.map((line) => line.amountMinor));
        assert.deepEqual(
          preview.lines.map((line) => [line.billingPeriodStartsAt, line.billingPeriodEndsAt]),
          order.lines.map((line) => [line.billingPeriodStartsAt, line.billingPeriodEndsAt]),
          "preview period estimates match the draft's server-planned periods when entitlement state is unchanged",
        );
        const draftRead = await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: order.id }, now, tx);
        assert.equal(draftRead.status, "draft");
        const ownerFirstPage = await orderRead.listCustomerBillingOrders({ authenticatedUserId: owner.id, limit: 1 }, now, tx);
        assert.equal(ownerFirstPage.items.length, 1);
        assert.ok(ownerFirstPage.nextCursor);
        const ownerNextPage = await orderRead.listCustomerBillingOrders({
          authenticatedUserId: owner.id, limit: 1, cursor: ownerFirstPage.nextCursor!,
        }, now, tx);
        assert.equal(ownerNextPage.items.length, 1);
        assert.notEqual(ownerFirstPage.items[0].id, ownerNextPage.items[0].id, "stable cursor pagination does not repeat an order");
        assert.deepEqual((await orderRead.listCustomerBillingOrders({ authenticatedUserId: manager.id }, now, tx)).items, [],
          "manager cannot discover orders after permission revocation");
        await assert.rejects(orderRead.getCustomerBillingOrder({ authenticatedUserId: manager.id, billingOrderId: order.id }, now, tx),
          (error: unknown) => error instanceof orderRead.BillingOrderReadError && error.code === "not_found",
          "partial or revoked Location authority hides the entire multi-Location order");
        assertionCount += 8;
        assertionCount += 1;
        assert.equal(order.status, "draft");
        assert.equal(order.providerCode, "fake-staging");
        assert.equal(order.currency, "RUB");
        assert.equal(order.totalAmountMinor, "3024000");
        assert.deepEqual(order.lines.map((line) => line.amountMinor), ["108000", "216000", "900000", "1800000"]);
        assert.equal(order.lines[0].subscriptionId, existingSubscription.id);
        assert.equal(order.lines[0].billingPeriodStartsAt, "2026-10-31T10:00:00.000Z");
        assert.equal(order.lines[0].billingPeriodEndsAt, "2026-11-30T10:00:00.000Z");
        assert.equal(order.lines[1].billingPeriodStartsAt, trialLocationTrial.endsAt.toISOString(), "trial-covered time is not consumed by the purchase");
        assert.equal(order.lines[1].billingPeriodEndsAt, "2027-01-08T10:00:00.000Z", "the full two-month duration starts at trial end");
        assertionCount += 8;

        const persistedLines = await tx.select().from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, order.id));
        assert.equal(persistedLines.length, 4);
        assert.equal(persistedLines.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(3_024_000));
        const [persistedOrder] = await tx.select().from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, order.id));
        assert.equal(persistedOrder.status, "draft");
        assertionCount += 3;

        const abandonedDraft = await service.createPrepaidBillingOrder({ ...input, lines: [input.lines[0]] }, { db: tx, now, env: process.env });
        assert.deepEqual(await orderLifecycle.abandonCustomerBillingOrderDraft({
          authenticatedUserId: owner.id, billingOrderId: abandonedDraft.id,
        }, tx), { id: abandonedDraft.id, status: "canceled" });
        assert.equal((await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: abandonedDraft.id }, now, tx)).status, "canceled");
        assert.equal((await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.billingOrderId, abandonedDraft.id))).length, 0, "abandoning a draft creates no Payment and preserves the order audit row");
        await assert.rejects(orderLifecycle.abandonCustomerBillingOrderDraft({
          authenticatedUserId: owner.id, billingOrderId: abandonedDraft.id,
        }, tx), (error: unknown) => error instanceof orderLifecycle.BillingOrderLifecycleError && error.code === "not_abandonable",
        "a canceled draft cannot be reactivated or abandoned again");
        assertionCount += 4;

        const repeatedDraft = await service.createPrepaidBillingOrder(input, { db: tx, now, env: process.env });
        assert.notEqual(repeatedDraft.id, order.id, "independent draft requests remain distinct; neither reserves checkout");
        assert.equal(repeatedDraft.totalAmountMinor, order.totalAmountMinor);
        assertionCount += 2;

        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [input.lines[0], input.lines[0]] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "duplicate_line");
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [{ ...input.lines[0], durationMonths: 13 }] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "invalid_request");
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [{ ...input.lines[0], locationId: outsideLocation.id }] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized");
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, organizationId: outsideOrganization.id }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized");
        assertionCount += 5;

        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [{ ...input.lines[2], locationId: locations[0].id }] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "unbounded_subscription_requires_policy");
        await tx.update(schema.locations).set({ marketCode: null }).where(eq(schema.locations.id, locations[0].id));
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [input.lines[0]] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "market_not_configured");
        await tx.update(schema.locations).set({ marketCode: "RU" }).where(eq(schema.locations.id, locations[0].id));
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: false }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [input.lines[0]] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "route_unavailable");
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: true }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: false }).where(eq(schema.commercialPaymentProviders.code, provider.code));
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [input.lines[0]] }, { db: tx, now, env: process.env }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "route_unavailable");
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: true }).where(eq(schema.commercialPaymentProviders.code, provider.code));
        assertionCount += 4;

        const disabledProviderOrder = await service.createPrepaidBillingOrder({ ...input, lines: [input.lines[3]] }, { db: tx, now, env: process.env });
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: false }).where(eq(schema.commercialPaymentProviders.code, provider.code));
        await assertAggregateError(aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: disabledProviderOrder.id,
        }, now, tx), "route_unavailable");
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: true }).where(eq(schema.commercialPaymentProviders.code, provider.code));

        const staleRouteOrder = await service.createPrepaidBillingOrder({ ...input, lines: [input.lines[3]] }, { db: tx, now, env: process.env });
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: false }).where(eq(schema.commercialPaymentRoutes.id, routes[1].id));
        await assertAggregateError(aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: staleRouteOrder.id,
        }, now, tx), "route_unavailable");
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: true }).where(eq(schema.commercialPaymentRoutes.id, routes[1].id));

        await tx.update(schema.locations).set({ marketCode: "RU" }).where(eq(schema.locations.id, locations[4].id));
        const changedPriceOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[4].id, productId: products[1].id, durationMonths: 12 },
        ] }, {
          db: tx, now, env: process.env,
          pricingAdapters: [{ providerCode: "fake-staging", quote: ({ durationMonths }) => ({
            currency: "RUB", listAmountMinor: BigInt(108_001 * durationMonths), discountAmountMinor: BigInt(0),
          }) }],
        });
        const changedPriceCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: changedPriceOrder.id,
        }, now, tx);
        assert.equal(changedPriceCheckout.amountMinor, 1_296_012, "checkout preserves the exact previously quoted 12-month draft amount");

        const savedPriceOrder = await service.createPrepaidBillingOrder({
          ...input, lines: [{ locationId: locations[4].id, productId: products[0].id, durationMonths: 1 }],
        }, { db: tx, now, env: process.env });
        await tx.update(schema.commercialProducts).set({ priceMinor: 150_000, updatedAt: now }).where(eq(schema.commercialProducts.id, products[0].id));
        const savedPriceCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: savedPriceOrder.id,
        }, now, tx);
        assert.equal(savedPriceCheckout.amountMinor, 108_000, "catalog price edits do not alter an existing draft quote");
        await tx.update(schema.commercialProducts).set({ priceMinor: 108_000, updatedAt: now }).where(eq(schema.commercialProducts.id, products[0].id));
        assertionCount += 4;

        const prepaidOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[0].id, productId: products[0].id, durationMonths: 1 },
          { locationId: locations[1].id, productId: products[0].id, durationMonths: 3 },
          { locationId: locations[2].id, productId: products[0].id, durationMonths: 12 },
        ] }, { db: tx, now, env: process.env });
        assert.equal(prepaidOrder.totalAmountMinor, "1728000", "one Product across several Locations is summed in integer minor units");
        assert.deepEqual(prepaidOrder.lines.map((line) => line.amountMinor), ["108000", "324000", "1296000"]);
        const aggregateCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id,
        }, now, tx);
        const repeatedCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id,
        }, new Date(now.getTime() + 1000), tx);
        assert.equal(repeatedCheckout.checkoutId, aggregateCheckout.checkoutId, "repeated checkout reuses the same pending aggregate payment");
        assert.equal(repeatedCheckout.confirmationToken, aggregateCheckout.confirmationToken, "same actor receives the same stable ticket");
        assert.equal(repeatedCheckout.checkoutUrl, aggregateCheckout.checkoutUrl, "repeated checkout returns the same transferable payer URL");
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: false }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        const resumedAfterRouteDisable = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id,
        }, new Date(now.getTime() + 1100), tx);
        assert.equal(resumedAfterRouteDisable.checkoutId, aggregateCheckout.checkoutId,
          "a pending aggregate checkout remains resumable after its route is disabled");
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: true }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        assertionCount += 1;
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[0].id, productId: products[0].id, durationMonths: 1 },
        ] }, { db: tx, now: new Date(now.getTime() + 1000), env: process.env }),
        (error: unknown) => error instanceof service.BillingOrderError && error.code === "checkout_pending",
        "a pending checkout prevents a second order for the same Location and Product");
        assertionCount += 1;
        assert.equal(new Date(aggregateCheckout.expiresAt).getTime() - now.getTime(), 7 * 24 * 60 * 60_000, "aggregate payer link expires after seven days");
        assert.match(aggregateCheckout.checkoutUrl, /^https:\/\/test\.soundspa\.bodhemusic\.com\/fake-checkout\//);
        const payerCapability = aggregateCheckout.checkoutUrl.split("/").pop()!;
        const retrievedLink = await aggregateFake.getFakeProviderBillingOrderCheckoutLink({
          authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id,
        }, new Date(now.getTime() + 1500), tx);
        assert.equal(retrievedLink.checkoutUrl, aggregateCheckout.checkoutUrl, "authorized user can retrieve the valid deterministic link");
        const [aggregatePaymentCountAtLink] = await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.billingOrderId, prepaidOrder.id));
        assert.ok(aggregatePaymentCountAtLink, "link retrieval reuses the single pending Payment");
        assert.equal((await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id }, now, tx)).status, "pending");
        const payerPreview = await aggregateFake.getFakeBillingOrderPayerView({ capability: payerCapability }, new Date(now.getTime() + 1500), tx);
        assert.equal(payerPreview.state, "pending");
        assert.equal(payerPreview.organizationName, organization.name);
        assert.equal(payerPreview.totalAmountMinor, "1728000");
        assert.equal(payerPreview.lines?.length, 3, "external payer sees only this frozen order's lines");
        assert.deepEqual(payerPreview.lines?.map((line) => line.amountMinor).sort(), ["108000", "1296000", "324000"]);
        const [lineToTamper] = await tx.select().from(schema.commercialBillingOrderLines)
          .where(eq(schema.commercialBillingOrderLines.orderId, prepaidOrder.id)).limit(1);
        await tx.update(schema.commercialBillingOrderLines).set({ durationMonths: lineToTamper.durationMonths === 12 ? 11 : lineToTamper.durationMonths + 1 })
          .where(eq(schema.commercialBillingOrderLines.id, lineToTamper.id));
        await assertAggregateError(aggregateFake.confirmFakeBillingOrderAsPayer({ capability: payerCapability }, new Date(now.getTime() + 1700), tx), "checkout_unavailable");
        await assertAggregateError(aggregateFake.getFakeBillingOrderPayerView({ capability: payerCapability }, new Date(now.getTime() + 1700), tx), "checkout_unavailable");
        await tx.update(schema.commercialBillingOrderLines).set({ durationMonths: lineToTamper.durationMonths })
          .where(eq(schema.commercialBillingOrderLines.id, lineToTamper.id));
        assert.equal(aggregateCheckout.amountMinor, 1_728_000);
        assert.equal(aggregateCheckout.currency, "RUB");
        const [pendingAggregate] = await tx.select().from(schema.commercialPayments).where(eq(schema.commercialPayments.billingOrderId, prepaidOrder.id));
        assert.equal(pendingAggregate.status, "pending");
        const pendingHistory = await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id }, now, tx);
        assert.equal(pendingHistory.status, "pending");
        assert.equal("checkoutUrl" in pendingHistory, false, "Account history never serializes a bearer checkout capability");
        assert.equal("confirmationToken" in pendingHistory, false, "Account history never serializes a confirmation token");
        assertionCount += 3;
        assert.equal(pendingAggregate.amountMinor, BigInt(1_728_000));
        assert.equal(pendingAggregate.locationId, null);
        assert.equal(pendingAggregate.productId, null);
        assert.equal((await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.billingOrderId, prepaidOrder.id))).length, 1, "checkout creates one aggregate Payment only");
        const [allocationToCorrupt] = await tx.select().from(schema.commercialPaymentAllocations)
          .where(eq(schema.commercialPaymentAllocations.orderId, prepaidOrder.id)).limit(1);
        await tx.update(schema.commercialPaymentAllocations).set({ amountMinor: allocationToCorrupt.amountMinor + BigInt(1) })
          .where(and(
            eq(schema.commercialPaymentAllocations.paymentId, allocationToCorrupt.paymentId),
            eq(schema.commercialPaymentAllocations.orderLineId, allocationToCorrupt.orderLineId),
          ));
        await assertAggregateError(aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: aggregateCheckout.confirmationToken,
        }, new Date(now.getTime() + 2000), tx), "checkout_unavailable");
        await tx.update(schema.commercialPaymentAllocations).set({ amountMinor: allocationToCorrupt.amountMinor })
          .where(and(
            eq(schema.commercialPaymentAllocations.paymentId, allocationToCorrupt.paymentId),
            eq(schema.commercialPaymentAllocations.orderLineId, allocationToCorrupt.orderLineId),
          ));
        await assert.rejects(singleFake.createFakeProviderCheckout({
          authenticatedUserId: owner.id, locationId: locations[0].id, productId: products[0].id, routeId: routes[0].id,
        }, new Date(now.getTime() + 2000), tx), (error: unknown) => error instanceof singleFake.FakeProviderError && error.code === "checkout_pending",
        "single-Location checkout cannot overlap an active prepaid reservation");

        // A separate paid period is recorded after checkout is frozen. Final
        // settlement must move this purchase behind it without losing months.
        await tx.insert(schema.locationSubscriptions).values({
          locationId: locations[1].id, productId: products[0].id, provider: provider.code,
          status: "active", startsAt: new Date("2026-11-08T10:00:00.000Z"), currentPeriodEndsAt: new Date("2026-12-08T10:00:00.000Z"),
          billingAnchorDay: 8, billingAnchorIsEndOfMonth: false,
        });

        const confirmationAt = new Date(now.getTime() + 3000);
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: false }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        const settledAggregate = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: aggregateCheckout.confirmationToken,
        }, confirmationAt, tx);
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: true }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        assert.equal(settledAggregate.duplicate, false);
        assert.equal(settledAggregate.allocations.length, 3);
        await tx.update(schema.commercialProducts).set({ priceMinor: 150_000, updatedAt: confirmationAt })
          .where(eq(schema.commercialProducts.id, products[0].id));
        const [historicalOrderAfterPriceEdit] = await tx.select({ totalAmountMinor: schema.commercialBillingOrders.totalAmountMinor,
          currency: schema.commercialBillingOrders.currency, status: schema.commercialBillingOrders.status })
          .from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, prepaidOrder.id));
        const [historicalPaymentAfterPriceEdit] = await tx.select({ amountMinor: schema.commercialPayments.amountMinor,
          currency: schema.commercialPayments.currency, status: schema.commercialPayments.status })
          .from(schema.commercialPayments).where(eq(schema.commercialPayments.billingOrderId, prepaidOrder.id));
        const historicalLinesAfterPriceEdit = await tx.select({ amountMinor: schema.commercialBillingOrderLines.amountMinor })
          .from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, prepaidOrder.id));
        assert.equal(historicalOrderAfterPriceEdit.totalAmountMinor, BigInt(1_728_000));
        assert.equal(historicalOrderAfterPriceEdit.currency, "RUB");
        assert.equal(historicalOrderAfterPriceEdit.status, "paid");
        assert.equal(historicalPaymentAfterPriceEdit.amountMinor, BigInt(1_728_000));
        assert.equal(historicalPaymentAfterPriceEdit.status, "succeeded");
        assert.deepEqual(historicalLinesAfterPriceEdit.map((line) => line.amountMinor).sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
          [BigInt(108_000), BigInt(324_000), BigInt(1_296_000)]);
        await tx.update(schema.commercialProducts).set({ priceMinor: 108_000, updatedAt: confirmationAt })
          .where(eq(schema.commercialProducts.id, products[0].id));
        assertionCount += 6;
        const repeatedSettlement = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: aggregateCheckout.confirmationToken,
        }, new Date(confirmationAt.getTime() + 1000), tx);
        assert.equal(repeatedSettlement.duplicate, true, "repeated success callback cannot extend twice");
        const [routeDisableLocation] = await tx.insert(schema.locations).values({
          organizationId: organization.id, name: "Route disable compatibility", slug: `billing-route-disable-${randomUUID().slice(0, 8)}`,
          timezone: "Europe/Moscow", marketCode: "RU",
        }).returning();
        const legacyPendingCheckout = await singleFake.createFakeProviderCheckout({
          authenticatedUserId: owner.id, locationId: routeDisableLocation.id, productId: products[0].id, routeId: routes[0].id,
        }, new Date(confirmationAt.getTime() + 1500), tx);
        await assert.rejects(service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: routeDisableLocation.id, productId: products[0].id, durationMonths: 1 },
        ] }, { db: tx, now: new Date(confirmationAt.getTime() + 2000), env: process.env }),
        (error: unknown) => error instanceof service.BillingOrderError && error.code === "checkout_pending",
        "legacy single-Location pending checkout also prevents an aggregate duplicate order");
        const [legacyPaymentBeforeDisable] = await tx.select({ amountMinor: schema.commercialPayments.amountMinor, currency: schema.commercialPayments.currency })
          .from(schema.commercialPayments).where(eq(schema.commercialPayments.id, legacyPendingCheckout.checkoutId));
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: false }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        await assert.rejects(singleFake.createFakeProviderCheckout({
          authenticatedUserId: owner.id, locationId: routeDisableLocation.id, productId: products[0].id, routeId: routes[0].id,
        }, new Date(confirmationAt.getTime() + 2500), tx),
        (error: unknown) => error instanceof singleFake.FakeProviderError && error.code === "route_unavailable",
        "disabling a route blocks a new single-Location checkout");
        const legacySettlement = await singleFake.confirmFakeProviderCheckout({
          authenticatedUserId: owner.id, confirmationToken: legacyPendingCheckout.confirmationToken,
        }, new Date(confirmationAt.getTime() + 3000), tx);
        assert.equal(legacySettlement.duplicate, false, "a pending single-Location payment still settles after route disable");
        const [legacyPaymentAfterSettlement] = await tx.select({ amountMinor: schema.commercialPayments.amountMinor, currency: schema.commercialPayments.currency, status: schema.commercialPayments.status })
          .from(schema.commercialPayments).where(eq(schema.commercialPayments.id, legacyPendingCheckout.checkoutId));
        assert.equal(legacyPaymentAfterSettlement.amountMinor, legacyPaymentBeforeDisable.amountMinor);
        assert.equal(legacyPaymentAfterSettlement.currency, legacyPaymentBeforeDisable.currency);
        assert.equal(legacyPaymentAfterSettlement.status, "succeeded");
        await tx.update(schema.commercialPaymentRoutes).set({ isEnabled: true }).where(eq(schema.commercialPaymentRoutes.id, routes[0].id));
        assertionCount += 8;
        const paidLines = await tx.select({
          lineId: schema.commercialPaymentAllocations.orderLineId,
          amountMinor: schema.commercialPaymentAllocations.amountMinor,
          subscriptionId: schema.commercialBillingOrderLines.subscriptionId,
          locationId: schema.commercialBillingOrderLines.locationId,
          durationMonths: schema.commercialBillingOrderLines.durationMonths,
          anchorDay: schema.commercialBillingOrderLines.billingAnchorDay,
          anchorEom: schema.commercialBillingOrderLines.billingAnchorIsEndOfMonth,
          startsAt: schema.locationSubscriptions.startsAt,
          periodEnd: schema.locationSubscriptions.currentPeriodEndsAt,
          providerRef: schema.locationSubscriptions.providerSubscriptionRef,
        }).from(schema.commercialPaymentAllocations)
          .innerJoin(schema.commercialBillingOrderLines, eq(schema.commercialBillingOrderLines.id, schema.commercialPaymentAllocations.orderLineId))
          .innerJoin(schema.locationSubscriptions, eq(schema.locationSubscriptions.id, schema.commercialBillingOrderLines.subscriptionId))
          .where(eq(schema.commercialPaymentAllocations.orderId, prepaidOrder.id));
        assert.equal(paidLines.length, 3);
        assert.equal(paidLines.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(1_728_000));
        const paidByLocation = new Map(paidLines.map((line) => [line.locationId, line]));
        assert.equal(paidByLocation.get(locations[0].id)?.periodEnd?.toISOString(), "2026-11-30T10:00:00.000Z", "existing month-end anchor is retained");
        assert.equal(paidByLocation.get(locations[1].id)?.startsAt.toISOString(), "2026-11-08T10:00:00.000Z", "paid coverage starts when the trial ends");
        assert.equal(paidByLocation.get(locations[1].id)?.periodEnd?.toISOString(), "2027-03-08T10:00:00.000Z", "the existing period added after checkout is followed by the full purchased duration");
        assert.equal(paidByLocation.get(locations[2].id)?.periodEnd?.toISOString(), "2027-10-08T10:00:03.000Z", "twelve months follow the third Location's calendar anchor");
        assert.ok(paidLines.every((line) => line.providerRef === null), "prepaid lines do not create a renewal provider reference");
        const paidOrderView = await customerBilling.listCustomerBilling(owner.id, confirmationAt, tx);
        assert.equal(paidOrderView.locations.find((location) => location.id === locations[1].id)?.products.find((product) => product.productId === products[0].id)?.subscriptionId, null,
          "prepaid coverage does not expose a Cancel renewal action");
        assert.equal(paidOrderView.locations.find((location) => location.id === locations[1].id)?.products.find((product) => product.productId === products[0].id)?.paidStartsAt, "2026-11-08T10:00:00.000Z",
          "Account exposes the paid start date alongside the still-active trial");
        assert.deepEqual(paidOrderView.locations.find((location) => location.id === locations[1].id)?.products.find((product) => product.productId === products[0].id)?.scheduledPaidPeriods,
          [{ startsAt: "2026-11-08T10:00:00.000Z", endsAt: "2027-03-08T10:00:00.000Z" }],
          "scheduled paid coverage remains visible independently of current trial status");
        assertionCount += 1;
        const [paidOrder] = await tx.select({ status: schema.commercialBillingOrders.status }).from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, prepaidOrder.id));
        const [paidPayment] = await tx.select({ status: schema.commercialPayments.status }).from(schema.commercialPayments).where(eq(schema.commercialPayments.billingOrderId, prepaidOrder.id));
        assert.equal(paidOrder.status, "paid");
        assert.equal(paidPayment.status, "succeeded");
        const settledOrderView = await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id }, confirmationAt, tx);
        assert.equal(settledOrderView.status, "paid");
        const trialProductLine = settledOrderView.lines.find((line) => line.locationId === locations[1].id)!;
        assert.equal(trialProductLine.durationMonths, 3, "settlement retains the purchased duration");
        assert.equal(trialProductLine.billingPeriodStartsAt, "2026-12-08T10:00:00.000Z", "order history exposes the actual rescheduled start");
        assert.equal(trialProductLine.billingPeriodEndsAt, "2027-03-08T10:00:00.000Z", "order history exposes the full actual purchased period");

        await permissionService.grantLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        const managerCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: manager.id, billingOrderId: managerOrder.id,
        }, new Date(now.getTime() + 4000), tx);
        const pendingOrderBillingView = await customerBilling.listCustomerBilling(owner.id, now, tx);
        for (const location of [locations[4], locations[5]]) {
          const product = pendingOrderBillingView.locations.find((row) => row.id === location.id)?.products
            .find((row) => row.productId === products[0].id);
          assert.equal(product?.status, "available", "a pending checkout for Location A does not hide products for new Locations B/C");
        }
        assertionCount += 2;
        await permissionService.revokeLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        await assertAggregateError(aggregateFake.getFakeProviderBillingOrderCheckoutLink({
          authenticatedUserId: manager.id, billingOrderId: managerOrder.id,
        }, new Date(now.getTime() + 4500), tx), "not_authorized");
        await assertAggregateError(aggregateFake.cancelFakeProviderBillingOrderCheckout({
          authenticatedUserId: manager.id, billingOrderId: managerOrder.id,
        }, new Date(now.getTime() + 4500), tx), "not_authorized");
        await aggregateFake.cancelFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: managerOrder.id,
        }, new Date(now.getTime() + 5000), tx);
        assert.ok(managerCheckout.checkoutUrl.includes("/fake-checkout/"), "delegated manager can receive a link before revocation");
        assert.equal((await customerBilling.listCustomerBilling(manager.id, now, tx)).locations.length, 0,
          "revoked billing permission is not retained for subsequent authenticated actions");

        const conflictInput = {
          orderId: prepaidOrder.id,
          paymentId: pendingAggregate.id,
          providerCode: "fake-staging",
          paymentKey: pendingAggregate.paymentKey,
          externalPaymentId: pendingAggregate.externalPaymentId,
          idempotencyKey: `fake-order-success:${prepaidOrder.id}`,
          externalEventId: `fake-order-success:${prepaidOrder.id}`,
          amountMinor: BigInt(1_728_001),
          currency: "RUB",
          occurredAt: confirmationAt,
        };
        const lifecycle = await import("../../db/v2/services/paymentLifecycle");
        await assert.rejects(lifecycle.settleTrustedBillingOrderPayment(conflictInput, tx),
          (error: unknown) => error instanceof Error &&
            error.name === "PaymentFoundationError" &&
            "code" in error && error.code === "payment_identity_conflict" &&
            error.message === "payment_identity_conflict");

        const externalOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[2].id, productId: products[1].id, durationMonths: 1 },
        ] }, { db: tx, now, env: process.env });
        const externalCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: externalOrder.id,
        }, now, tx);
        const externalCapability = externalCheckout.checkoutUrl.split("/").pop()!;
        const externalResult = await aggregateFake.confirmFakeBillingOrderAsPayer({ capability: externalCapability }, new Date(now.getTime() + 6000), tx);
        assert.equal(externalResult.state, "paid", "external payer settles without a SoundSpa user session");
        const externalReplay = await aggregateFake.confirmFakeBillingOrderAsPayer({ capability: externalCapability }, new Date(now.getTime() + 7000), tx);
        assert.equal(externalReplay.state, "already_paid", "payer capability replay cannot settle a second time");
        const externalViewAfterPay = await aggregateFake.getFakeBillingOrderPayerView({ capability: externalCapability }, new Date(now.getTime() + 7000), tx);
        assert.equal(externalViewAfterPay.state, "already_paid");
        const externalLine = await tx.select({ subscriptionId: schema.commercialBillingOrderLines.subscriptionId })
          .from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, externalOrder.id));
        assert.equal(externalLine.length, 1);
        assert.ok(externalLine[0].subscriptionId);
        assert.equal((await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions)
          .where(and(eq(schema.locationSubscriptions.locationId, locations[2].id), eq(schema.locationSubscriptions.productId, products[1].id)))).length, 1,
        "external payer's replay creates no duplicate Subscription");

        const canceledOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[3].id, productId: products[1].id, durationMonths: 1 },
        ] }, { db: tx, now, env: process.env });
        const canceledCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id, billingOrderId: canceledOrder.id }, now, tx);
        await aggregateFake.cancelFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id, billingOrderId: canceledOrder.id }, new Date(now.getTime() + 1000), tx);
        const canceledCapability = canceledCheckout.checkoutUrl.split("/").pop()!;
        assert.equal((await aggregateFake.getFakeBillingOrderPayerView({ capability: canceledCapability }, new Date(now.getTime() + 1000), tx)).state, "canceled");
        assert.equal((await aggregateFake.confirmFakeBillingOrderAsPayer({ capability: canceledCapability }, new Date(now.getTime() + 1000), tx)).state, "canceled",
          "authorized cancellation revokes the external payment capability immediately");
        await assertAggregateError(aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: canceledCheckout.confirmationToken,
        }, new Date(now.getTime() + 1000), tx), "checkout_unavailable");
        const expiredOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[3].id, productId: products[1].id, durationMonths: 1 },
        ] }, { db: tx, now, env: process.env });
        const expiredCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id, billingOrderId: expiredOrder.id }, now, tx);
        const expiredCapability = expiredCheckout.checkoutUrl.split("/").pop()!;
        const afterSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60_000 + 1);
        assert.equal((await aggregateFake.getFakeBillingOrderPayerView({ capability: expiredCapability }, afterSevenDays, tx)).state, "expired");
        assert.equal((await orderRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: expiredOrder.id }, afterSevenDays, tx)).status, "expired");
        assert.equal((await tx.select({ status: schema.commercialBillingOrders.status }).from(schema.commercialBillingOrders)
          .where(eq(schema.commercialBillingOrders.id, expiredOrder.id)))[0].status, "pending",
        "status read derives expiry without mutating the stored financial state");
        await assertAggregateError(aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: expiredCheckout.confirmationToken,
        }, afterSevenDays, tx), "checkout_expired");
        await assertAggregateError(aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: expiredOrder.id,
        }, afterSevenDays, tx), "checkout_expired");
        const replacementOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[3].id, productId: products[1].id, durationMonths: 1 },
        ] }, { db: tx, now: afterSevenDays, env: process.env });
        const replacementCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: replacementOrder.id,
        }, afterSevenDays, tx);
        assert.notEqual(replacementCheckout.checkoutId, expiredCheckout.checkoutId, "expired checkout retries use a fresh validated Order and Payment");
        assertionCount += 38;

        const atomicLocations = [locations[0], locations[1], locations[3]].sort((left, right) => left.id.localeCompare(right.id));
        const atomicOrder = await service.createPrepaidBillingOrder({ ...input, lines: atomicLocations.map((location, index) => ({
          locationId: location.id, productId: products[0].id, durationMonths: [1, 3, 12][index],
        })) }, { db: tx, now: new Date(now.getTime() + 4000), env: process.env });
        const atomicCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: atomicOrder.id,
        }, new Date(now.getTime() + 4000), tx);
        const poisonLocation = atomicLocations[atomicLocations.length - 1];
        const [unboundedAfterFreeze] = await tx.insert(schema.locationSubscriptions).values({
          locationId: poisonLocation.id, productId: products[0].id, provider: provider.code,
          status: "active", startsAt: now, currentPeriodEndsAt: null,
        }).returning();
        const subscriptionEndsBeforeFailure = await tx.select({ id: schema.locationSubscriptions.id, currentPeriodEndsAt: schema.locationSubscriptions.currentPeriodEndsAt })
          .from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.productId, products[0].id));
        await assertAggregateError(aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: atomicCheckout.confirmationToken,
        }, new Date(now.getTime() + 5000), tx), "checkout_unavailable");
        assert.deepEqual(await tx.select({ id: schema.locationSubscriptions.id, currentPeriodEndsAt: schema.locationSubscriptions.currentPeriodEndsAt })
          .from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.productId, products[0].id)), subscriptionEndsBeforeFailure,
        "a failing last line rolls back earlier Subscription extensions");
        assert.equal((await tx.select({ id: schema.commercialPaymentAllocations.orderLineId }).from(schema.commercialPaymentAllocations)
          .where(eq(schema.commercialPaymentAllocations.orderId, atomicOrder.id))).length, 3,
        "the frozen allocation plan remains attached to the still-pending payment after settlement rollback");
        const [atomicPending] = await tx.select({ status: schema.commercialPayments.status }).from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.billingOrderId, atomicOrder.id));
        assert.equal(atomicPending.status, "pending", "failed aggregate settlement leaves its payment retryable");
        await tx.delete(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.id, unboundedAfterFreeze.id));
        const atomicRetry = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: atomicCheckout.confirmationToken,
        }, new Date(now.getTime() + 6000), tx);
        assert.equal(atomicRetry.duplicate, false, "a corrected transient line failure can safely retry the same checkout");
        assertionCount += 6;

        const [unchangedSubscription] = await tx.select().from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.id, existingSubscription.id));
        assert.ok(unchangedSubscription.currentPeriodEndsAt && unchangedSubscription.currentPeriodEndsAt >= new Date("2026-11-30T10:00:00.000Z"),
          "prepaid settlement preserves and extends the existing paid-through date");
        assert.deepEqual(await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials), beforeTrials);
        assert.deepEqual(await tx.select({ id: schema.commercialPartnerBenefits.id }).from(schema.commercialPartnerBenefits), beforeBenefits);
        assert.deepEqual(await tx.select({ id: schema.locationChannelGrants.id, enabled: schema.locationChannelGrants.enabled,
          startsAt: schema.locationChannelGrants.startsAt, endsAt: schema.locationChannelGrants.endsAt, updatedAt: schema.locationChannelGrants.updatedAt,
        }).from(schema.locationChannelGrants), beforeAdminGrants, "subscription settlement leaves Location Admin Grants unchanged");
        assert.equal((await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions)).length, beforeSubscriptions.length + 5);
        assert.equal((await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)).length, 10,
          "the two frozen-price checkout fixtures each create one payment snapshot");
        assertionCount += 5;

        const routeSnapshot = await tx.select({ id: schema.commercialPaymentRoutes.id }).from(schema.commercialPaymentRoutes).where(and(
          eq(schema.commercialPaymentRoutes.id, routes[0].id), eq(schema.commercialPaymentRoutes.isEnabled, true),
        ));
        assert.equal(routeSnapshot.length, 1);
        assertionCount += 1;

        // Exercise a true multi-Product order for one Location. Basic follows
        // its active trial, while the private Product independently extends
        // existing paid coverage. The one aggregate payment must allocate to
        // both lines and repeated confirmation must not add time twice.
        const multiProductLocation = locations[5];
        await tx.update(schema.locations).set({ marketCode: "RU" }).where(eq(schema.locations.id, multiProductLocation.id));
        const multiProductNow = new Date(now.getTime() + 10_000);
        const trialEndsAt = new Date("2026-11-08T10:00:00.000Z");
        const paidEndsAt = new Date("2026-10-23T10:00:00.000Z");
        await tx.update(schema.commercialProducts).set({ priceMinor: 108_000, visibility: "private" })
          .where(eq(schema.commercialProducts.id, products[1].id));
        await tx.insert(schema.commercialProductOrganizationAuthorizations).values({
          organizationId: organization.id, productId: products[1].id,
          grantSource: "operator", grantedByOperator: "billing-order-integration-test",
          grantReason: "Authorize the private Product in an isolated aggregate billing fixture",
        });
        await tx.insert(schema.locationCoreTrials).values({
          locationId: multiProductLocation.id, productId: products[0].id, status: "active",
          startsAt: new Date("2026-10-01T10:00:00.000Z"), endsAt: trialEndsAt,
        });
        const [existingPartnerPeriod] = await tx.insert(schema.locationSubscriptions).values({
          locationId: multiProductLocation.id, productId: products[1].id, provider: provider.code,
          status: "active", startsAt: new Date("2026-09-23T10:00:00.000Z"),
          currentPeriodEndsAt: paidEndsAt, billingAnchorDay: 23, billingAnchorIsEndOfMonth: false,
        }).returning();
        const multiProductRequest = {
          authenticatedUserId: owner.id, organizationId: organization.id,
          lines: [
            { locationId: multiProductLocation.id, productId: products[0].id, durationMonths: 1 },
            { locationId: multiProductLocation.id, productId: products[1].id, durationMonths: 1 },
          ],
        };
        const multiProductQuote = await service.previewPrepaidBillingOrder(multiProductRequest, { db: tx, now: multiProductNow, env: process.env });
        assert.equal(multiProductQuote.totalAmountMinor, "216000");
        assert.equal(multiProductQuote.lines.length, 2);
        assert.ok(multiProductQuote.lines.every((line) => line.locationId === multiProductLocation.id));
        assert.equal(multiProductQuote.lines[0].billingPeriodStartsAt, trialEndsAt.toISOString());
        assert.equal(multiProductQuote.lines[0].billingPeriodEndsAt, "2026-12-08T10:00:00.000Z");
        assert.equal(multiProductQuote.lines[1].billingPeriodStartsAt, paidEndsAt.toISOString());
        assert.equal(multiProductQuote.lines[1].billingPeriodEndsAt, "2026-11-23T10:00:00.000Z");
        const independentDurationQuote = await service.previewPrepaidBillingOrder({
          ...multiProductRequest,
          lines: [
            { locationId: multiProductLocation.id, productId: products[0].id, durationMonths: 1 },
            { locationId: multiProductLocation.id, productId: products[1].id, durationMonths: 3 },
          ],
        }, { db: tx, now: multiProductNow, env: process.env });
        assert.equal(independentDurationQuote.totalAmountMinor, "432000");
        assert.deepEqual(independentDurationQuote.lines.map((line) => line.durationMonths), [1, 3]);
        assert.equal(independentDurationQuote.lines[0].billingPeriodEndsAt, "2026-12-08T10:00:00.000Z");
        assert.equal(independentDurationQuote.lines[1].billingPeriodEndsAt, "2027-01-23T10:00:00.000Z");
        const multiProductOrder = await service.createPrepaidBillingOrder(multiProductRequest, { db: tx, now: multiProductNow, env: process.env });
        assert.equal(multiProductOrder.lines.length, 2);
        assert.equal(new Set(multiProductOrder.lines.map((line) => `${line.locationId}:${line.productId}`)).size, 2);
        assert.equal(multiProductOrder.totalAmountMinor, "216000");
        const multiProductCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: multiProductOrder.id,
        }, multiProductNow, tx);
        const multiProductPayments = await tx.select().from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.billingOrderId, multiProductOrder.id));
        const multiProductAllocations = await tx.select().from(schema.commercialPaymentAllocations)
          .where(eq(schema.commercialPaymentAllocations.orderId, multiProductOrder.id));
        assert.equal(multiProductPayments.length, 1);
        assert.equal(String(multiProductPayments[0].amountMinor), "216000");
        assert.equal(multiProductAllocations.length, 2);
        // Make the final line in settlement order temporarily unplannable.
        // The preceding line must roll back with it, leaving the aggregate
        // payment pending and safe to retry after the conflicting row clears.
        const frozenMultiLines = await tx.select({ id: schema.commercialBillingOrderLines.id, locationId: schema.commercialBillingOrderLines.locationId,
          productId: schema.commercialBillingOrderLines.productId }).from(schema.commercialBillingOrderLines)
          .where(eq(schema.commercialBillingOrderLines.orderId, multiProductOrder.id))
          .orderBy(asc(schema.commercialBillingOrderLines.id));
        const failingLine = frozenMultiLines[frozenMultiLines.length - 1];
        const [poisonedPeriod] = await tx.insert(schema.locationSubscriptions).values({
          locationId: failingLine.locationId, productId: failingLine.productId, provider: provider.code,
          status: "active", startsAt: multiProductNow, currentPeriodEndsAt: null,
        }).returning();
        const beforeMultiFailure = await tx.select({ id: schema.locationSubscriptions.id, currentPeriodEndsAt: schema.locationSubscriptions.currentPeriodEndsAt })
          .from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.locationId, multiProductLocation.id));
        await assertAggregateError(aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: multiProductCheckout.confirmationToken,
        }, new Date(multiProductNow.getTime() + 500), tx), "checkout_unavailable");
        assert.deepEqual(await tx.select({ id: schema.locationSubscriptions.id, currentPeriodEndsAt: schema.locationSubscriptions.currentPeriodEndsAt })
          .from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.locationId, multiProductLocation.id)), beforeMultiFailure,
        "failure processing one Product line rolls back all subscription changes for the other line");
        const [pendingMultiPayment] = await tx.select({ status: schema.commercialPayments.status }).from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.billingOrderId, multiProductOrder.id));
        assert.equal(pendingMultiPayment.status, "pending");
        await tx.delete(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.id, poisonedPeriod.id));
        const multiProductSettlement = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: multiProductCheckout.confirmationToken,
        }, new Date(multiProductNow.getTime() + 1000), tx);
        assert.equal(multiProductSettlement.duplicate, false);
        assert.equal(multiProductSettlement.allocations.length, 2);
        const paidProducts = await tx.select().from(schema.locationSubscriptions).where(and(
          eq(schema.locationSubscriptions.locationId, multiProductLocation.id),
          inArray(schema.locationSubscriptions.productId, [products[0].id, products[1].id]),
        ));
        assert.equal(paidProducts.length, 2);
        const basicPaid = paidProducts.find((row) => row.productId === products[0].id);
        const partnerPaid = paidProducts.find((row) => row.productId === products[1].id);
        assert.ok(basicPaid && partnerPaid && basicPaid.id !== partnerPaid.id);
        assert.equal(basicPaid.startsAt.toISOString(), trialEndsAt.toISOString());
        assert.equal(basicPaid.currentPeriodEndsAt?.toISOString(), "2026-12-08T10:00:00.000Z");
        assert.equal(partnerPaid.id, existingPartnerPeriod.id, "same Product extension reuses its paid subscription row");
        assert.equal(partnerPaid.startsAt.toISOString(), "2026-09-23T10:00:00.000Z");
        assert.equal(partnerPaid.currentPeriodEndsAt?.toISOString(), "2026-11-23T10:00:00.000Z");
        assert.notEqual(existingPartnerPeriod.id, basicPaid.id);
        const settledLinePeriods = await tx.select({ productId: schema.commercialBillingOrderLines.productId,
          startsAt: schema.commercialBillingOrderLines.billingPeriodStartsAt, endsAt: schema.commercialBillingOrderLines.billingPeriodEndsAt,
        }).from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, multiProductOrder.id));
        const basicLinePeriod = settledLinePeriods.find((line) => line.productId === products[0].id);
        const partnerLinePeriod = settledLinePeriods.find((line) => line.productId === products[1].id);
        assert.equal(basicLinePeriod?.startsAt?.toISOString(), trialEndsAt.toISOString());
        assert.equal(partnerLinePeriod?.startsAt?.toISOString(), paidEndsAt.toISOString());
        assert.equal(partnerLinePeriod?.endsAt?.toISOString(), "2026-11-23T10:00:00.000Z");
        const replayedMultiProductSettlement = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: multiProductCheckout.confirmationToken,
        }, new Date(multiProductNow.getTime() + 2000), tx);
        assert.equal(replayedMultiProductSettlement.duplicate, true);
        const afterReplay = await tx.select({ id: schema.locationSubscriptions.id, currentPeriodEndsAt: schema.locationSubscriptions.currentPeriodEndsAt })
          .from(schema.locationSubscriptions).where(and(
            eq(schema.locationSubscriptions.locationId, multiProductLocation.id),
            inArray(schema.locationSubscriptions.productId, [products[0].id, products[1].id]),
          ));
        assert.deepEqual(afterReplay, paidProducts.map(({ id, currentPeriodEndsAt }) => ({ id, currentPeriodEndsAt })));
        assertionCount += 35;

        const manualTestLocations = await tx.insert(schema.locations).values([1, 2, 3].map((number) => ({
          organizationId: organization.id, name: `Manual billing ${number}`,
          slug: `manual-billing-${suffix.slice(0, 8)}-${number}`, timezone: "Europe/Moscow", marketCode: "RU",
        }))).returning();
        const manualLines = manualTestLocations.map((location) => ({ locationId: location.id, productId: products[0].id }));
        const manualInput = {
          organizationId: organization.id, operatorAuthorization: manualOperatorAuthorization, reason: "Approved three-salon bank transfer",
          idempotencyKey: `manual-invoice-${suffix.slice(0, 24)}`, periodStart: "2028-11-01", durationMonths: 1,
          currency: "RUB", totalAmountMinor: "10001", invoiceNumber: `SAM-${suffix.slice(0, 8)}`, invoiceIssuedAt: "2028-10-20", paymentDueAt: "2028-10-25", lines: manualLines,
        };
        await assert.rejects(service.createManualBankTransferBillingOrder({ ...manualInput, operatorAuthorization: "Basic invalid" }, { db: tx, now }),
          (error: unknown) => error instanceof service.BillingOrderError && error.code === "not_authorized");
        const beforeManualSubscriptions = await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions);
        const earlyInvoice = await service.createManualBankTransferBillingOrder(manualInput, {
          db: tx, now: new Date("2028-10-25T10:00:00.000Z"),
        });
        assert.equal(earlyInvoice.duplicate, false);
        assert.equal(earlyInvoice.totalAmountMinor, "10001");
        const [earlyInvoiceMetadata] = await tx.select({ invoiceNumber: schema.commercialBillingOrders.externalInvoiceNumber,
          issuedAt: schema.commercialBillingOrders.invoiceIssuedAt, dueAt: schema.commercialBillingOrders.paymentDueAt,
        }).from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, earlyInvoice.id));
        assert.equal(earlyInvoiceMetadata.invoiceNumber, manualInput.invoiceNumber);
        assert.equal(earlyInvoiceMetadata.issuedAt?.toISOString(), "2028-10-20T00:00:00.000Z");
        assert.equal(earlyInvoiceMetadata.dueAt?.toISOString(), "2028-10-25T00:00:00.000Z");
        const manualOrderLines = await tx.select().from(schema.commercialBillingOrderLines)
          .where(eq(schema.commercialBillingOrderLines.orderId, earlyInvoice.id));
        assert.equal(manualOrderLines.length, 3);
        assert.equal(manualOrderLines.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(10001));
        assert.deepEqual(manualOrderLines.map((line) => line.amountMinor).sort((a, b) => a < b ? -1 : a > b ? 1 : 0), [BigInt(3333), BigInt(3334), BigInt(3334)]);
        assert.ok(manualOrderLines.every((line) => line.billingPeriodStartsAt?.toISOString() === "2028-11-01T00:00:00.000Z" &&
          line.billingPeriodEndsAt?.toISOString() === "2028-12-01T00:00:00.000Z"));
        const manualPayment = (await tx.select().from(schema.commercialPayments)
          .where(eq(schema.commercialPayments.id, earlyInvoice.paymentId!)))[0];
        const manualAllocations = await tx.select().from(schema.commercialPaymentAllocations)
          .where(eq(schema.commercialPaymentAllocations.paymentId, manualPayment.id));
        assert.equal(manualPayment.status, "pending", "order creation records an expected transfer only");
        assert.equal(manualAllocations.reduce((sum, row) => sum + row.amountMinor, BigInt(0)), BigInt(10001));
        const lateRetry = await service.createManualBankTransferBillingOrder(manualInput, {
          db: tx, now: new Date("2028-11-20T10:00:00.000Z"),
        });
        assert.equal(lateRetry.id, earlyInvoice.id, "late retry returns the same order rather than creating a second extension");
        assert.equal(lateRetry.duplicate, true);
        const earlyReceipt = await paymentLifecycle.settleTrustedBillingOrderPayment({
          orderId: earlyInvoice.id, paymentId: earlyInvoice.paymentId!, providerCode: "manual-bank-transfer",
          paymentKey: `manual-order:${earlyInvoice.id}`, externalPaymentId: null,
          idempotencyKey: `bank-receipt-${suffix.slice(0, 20)}`, externalEventId: `bank-reference-${suffix.slice(0, 20)}`,
          amountMinor: BigInt(10001), currency: "RUB", occurredAt: new Date("2028-10-27T09:00:00.000Z"),
          bankTransactionReference: `bank-reference-${suffix.slice(0, 20)}`, confirmedByOperator: "billing-integration-operator", confirmationReason: "Matched full bank statement payment",
        }, tx);
        assert.equal(earlyReceipt.duplicate, false);
        const [recordedManualPayment] = await tx.select({ reference: schema.commercialPayments.bankTransactionReference })
          .from(schema.commercialPayments).where(eq(schema.commercialPayments.id, manualPayment.id));
        const [manualAudit] = await tx.select({ operator: schema.commercialPaymentEvents.confirmedByOperator,
          reason: schema.commercialPaymentEvents.confirmationReason,
        }).from(schema.commercialPaymentEvents).where(eq(schema.commercialPaymentEvents.paymentId, manualPayment.id));
        assert.equal(recordedManualPayment.reference, `bank-reference-${suffix.slice(0, 20)}`);
        assert.equal(manualAudit.operator, "billing-integration-operator");
        assert.equal(manualAudit.reason, "Matched full bank statement payment");
        const lateInvoice = await service.createManualBankTransferBillingOrder({
          ...manualInput, idempotencyKey: `manual-invoice-dec-${suffix.slice(0, 20)}`, invoiceNumber: `SAM-DEC-${suffix.slice(0, 8)}`, periodStart: "2028-12-01",
        }, { db: tx, now: new Date("2028-11-20T10:00:00.000Z") });
        const lateReceipt = await paymentLifecycle.settleTrustedBillingOrderPayment({
          orderId: lateInvoice.id, paymentId: lateInvoice.paymentId!, providerCode: "manual-bank-transfer",
          paymentKey: `manual-order:${lateInvoice.id}`, externalPaymentId: null,
          idempotencyKey: `bank-receipt-dec-${suffix.slice(0, 20)}`, externalEventId: `bank-reference-dec-${suffix.slice(0, 20)}`,
          amountMinor: BigInt(10001), currency: "RUB", occurredAt: new Date("2028-12-15T09:00:00.000Z"),
          bankTransactionReference: `bank-reference-dec-${suffix.slice(0, 20)}`, confirmedByOperator: "billing-integration-operator", confirmationReason: "Matched late bank transfer settlement",
        }, tx);
        assert.equal(lateReceipt.duplicate, false);
        const manualSubscriptionIds = [...new Set([...earlyReceipt.allocations, ...lateReceipt.allocations].map((row) => row.subscriptionId))];
        const manualCoverage = await tx.select({ startsAt: schema.locationSubscriptions.startsAt, endsAt: schema.locationSubscriptions.currentPeriodEndsAt,
          locationId: schema.locationSubscriptions.locationId, anchorDay: schema.locationSubscriptions.billingAnchorDay,
          anchorIsEom: schema.locationSubscriptions.billingAnchorIsEndOfMonth }).from(schema.locationSubscriptions)
          .where(inArray(schema.locationSubscriptions.id, manualSubscriptionIds))
          .orderBy(asc(schema.locationSubscriptions.locationId));
        assert.equal(manualCoverage.length, 3);
        assert.ok(manualCoverage.every((period) => period.startsAt.toISOString() === "2028-11-01T00:00:00.000Z" &&
          period.endsAt?.toISOString() === "2029-01-01T00:00:00.000Z" && period.anchorDay === 1 && period.anchorIsEom === false),
        "early and late receipts preserve invoiced first-of-month coverage and anchor");
        const duplicateReceipt = await paymentLifecycle.settleTrustedBillingOrderPayment({
          orderId: lateInvoice.id, paymentId: lateInvoice.paymentId!, providerCode: "manual-bank-transfer",
          paymentKey: `manual-order:${lateInvoice.id}`, externalPaymentId: null,
          idempotencyKey: `bank-receipt-dec-${suffix.slice(0, 20)}`, externalEventId: `bank-reference-dec-${suffix.slice(0, 20)}`,
          amountMinor: BigInt(10001), currency: "RUB", occurredAt: new Date("2028-12-15T09:00:00.000Z"),
          bankTransactionReference: `bank-reference-dec-${suffix.slice(0, 20)}`, confirmedByOperator: "billing-integration-operator", confirmationReason: "Matched late bank transfer settlement",
        }, tx);
        assert.equal(duplicateReceipt.duplicate, true, "a repeated bank receipt event does not extend access twice");
        const adminBillingSnapshot = await manualBillingAdmin.listManualBillingAdminData(manualOperatorAuthorization, tx, new Date("2028-12-20T00:00:00.000Z"));
        const adminSubscriptionSnapshot = await manualBillingAdmin.listManualSubscriptionOverview(manualOperatorAuthorization, tx, new Date("2028-12-20T00:00:00.000Z"));
        const listedEarlyInvoice = adminBillingSnapshot.orders.find((row) => row.id === earlyInvoice.id);
        assert.equal(listedEarlyInvoice?.status, "paid", "admin Payments read model shows settled invoices as paid");
        assert.equal(listedEarlyInvoice?.lines.length, 3, "admin payment history includes all linked salons");
        assert.equal(listedEarlyInvoice?.events[0]?.operator, "billing-integration-operator", "admin payment history exposes audit attribution");
        assert.ok(adminSubscriptionSnapshot.some((row) => row.organizationId === organization.id && row.status === "active"),
          "read-only subscription overview is derived from Location subscriptions");
        await assert.rejects(service.createManualBankTransferBillingOrder({ ...manualInput, idempotencyKey: `manual-invoice-alt-${suffix.slice(0, 20)}`, invoiceNumber: `SAM-ALT-${suffix.slice(0, 8)}` }, {
          db: tx, now: new Date("2028-11-20T10:00:00.000Z"),
        }), (error: unknown) => error instanceof service.BillingOrderError && error.code === "coverage_conflict");
        await assert.rejects(tx.transaction(async (savepoint) => service.createManualBankTransferBillingOrder({
          ...manualInput, idempotencyKey: `manual-invoice-dup-${suffix.slice(0, 20)}`, periodStart: "2029-01-01",
          invoiceIssuedAt: "2028-12-20", paymentDueAt: "2028-12-25",
        }, { db: savepoint, now: new Date("2028-12-20T10:00:00.000Z") })),
        "a normalized invoice number is unique within its Organization even with a different request key");
        assert.deepEqual(await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions).where(inArray(schema.locationSubscriptions.id, beforeManualSubscriptions.map((row) => row.id))), beforeManualSubscriptions,
          "manual order creation itself never grants or extends entitlement");
        assertionCount += 31;

        throw new Rollback("rollback-only");
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    const [rollbackOrganization] = fixtureOrganizationId
      ? await v2Db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, fixtureOrganizationId)).limit(1)
      : [];
    assert.equal(rollbackOrganization, undefined, "fixture Organization must not remain after rollback");
    const afterRollback = await v2Pool.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM location_billing_permissions) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) + (SELECT count(*) FROM commercial_product_visibility_events) + (SELECT count(*) FROM commercial_payment_providers WHERE code <> 'manual-bank-transfer') + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_payment_route_events) + (SELECT count(*) FROM commercial_billing_resets) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_billing_order_lines) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_events) + (SELECT count(*) FROM commercial_payment_allocations) AS count",
    );
    assert.equal(afterRollback.rows[0]?.count, "0", "all customer and commercial fixtures must be absent after rollback");
    assertionCount += 2;

    // Exercise real row-lock behavior with two committed, uniquely named
    // fixtures and two independent pooled transactions. Cleanup is guaranteed
    // in finally; no test fixture survives this concurrent check.
    const raceSuffix = randomUUID();
    let raceOrganizationId: string | null = null;
    try {
      const raceFixture = await v2Db.transaction(async (tx) => {
        const raceNow = new Date();
        const [organization] = await tx.insert(schema.organizations).values({ name: `billing-race-${raceSuffix}` }).returning();
        raceOrganizationId = organization.id;
        const [owner] = await tx.insert(schema.users).values({ email: `billing-race-${raceSuffix}@example.test`, emailVerifiedAt: raceNow }).returning();
        await tx.insert(schema.organizationMembers).values({ organizationId: organization.id, userId: owner.id, role: "owner" });
        const raceLocations = await tx.insert(schema.locations).values([1, 2, 3].map((number) => ({
          organizationId: organization.id, name: `Concurrent checkout ${number}`, slug: `billing-race-${raceSuffix.slice(0, 10)}-${number}`,
          timezone: "Europe/Moscow", marketCode: "RU",
        }))).returning();
        const [product] = await tx.insert(schema.commercialProducts).values({
          code: `billing-race-${raceSuffix}`, name: "Concurrent checkout product", kind: "core",
          priceMinor: 108_000, currency: "RUB", billingIntervalMonths: 1, isActive: true,
        }).returning();
        const [raceProvider] = await tx.insert(schema.commercialPaymentProviders).values({ code: "fake-staging", displayName: "Staging Fake Provider", isEnabled: true }).returning();
        const [route] = await tx.insert(schema.commercialPaymentRoutes).values({
          marketCode: "RU", productId: product.id, providerCode: raceProvider.code,
          externalReference: `billing-race:${raceSuffix}`, isEnabled: true,
        }).returning();
        const [manualProvider] = await tx.select({ code: schema.commercialPaymentProviders.code })
          .from(schema.commercialPaymentProviders).where(eq(schema.commercialPaymentProviders.code, "manual-bank-transfer")).limit(1);
        assert.ok(manualProvider);
        await tx.insert(schema.commercialPaymentRoutes).values({
          marketCode: "RU", productId: product.id, providerCode: manualProvider.code,
          externalReference: `manual-billing-race:${raceSuffix}`, isEnabled: true,
        });
        const location = raceLocations[0];
        const requested = { authenticatedUserId: owner.id, organizationId: organization.id, lines: [{ locationId: location.id, productId: product.id, durationMonths: 1 }] };
        const first = await service.createPrepaidBillingOrder(requested, { db: tx, now: raceNow, env: process.env });
        const second = await service.createPrepaidBillingOrder(requested, { db: tx, now: raceNow, env: process.env });
        return { ownerId: owner.id, locationId: location.id, locationIds: raceLocations.map((row) => row.id), productId: product.id, routeId: route.id, firstId: first.id, secondId: second.id, now: raceNow };
      });
      const competing = await Promise.allSettled([
        aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: raceFixture.ownerId, billingOrderId: raceFixture.firstId }, raceFixture.now),
        aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: raceFixture.ownerId, billingOrderId: raceFixture.secondId }, raceFixture.now),
      ]);
      const openedIndexes = competing.map((result, index) => result.status === "fulfilled" ? index : -1).filter((index) => index >= 0);
      const opened = competing.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof aggregateFake.createFakeProviderBillingOrderCheckout>>> => result.status === "fulfilled");
      const blocked = competing.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      assert.equal(opened.length, 1, `two competing payable orders reserve a Location/Product at most once (${competing.map((result) => result.status === "rejected" ? String(result.reason) : "opened").join("; ")})`);
      assert.equal(openedIndexes.length, 1);
      assert.equal(blocked.length, 1);
      assert.ok(blocked[0].reason instanceof aggregateFake.FakeBillingOrderError && blocked[0].reason.code === "checkout_pending");
      const winningOrderId = openedIndexes[0] === 0 ? raceFixture.firstId : raceFixture.secondId;
      const sameOrderConcurrent = await Promise.all([
        aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: raceFixture.ownerId, billingOrderId: winningOrderId }, new Date(raceFixture.now.getTime() + 1)),
        aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: raceFixture.ownerId, billingOrderId: winningOrderId }, new Date(raceFixture.now.getTime() + 1)),
      ]);
      assert.equal(sameOrderConcurrent[0].checkoutId, sameOrderConcurrent[1].checkoutId, "parallel retries return the same aggregate Payment");
      const racePayments = await v2Db.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)
        .where(eq(schema.commercialPayments.billingOrderId, winningOrderId));
      assert.equal(racePayments.length, 1, "concurrent retries create only one payable transaction");
      const simultaneousConfirmations = await Promise.all([
        aggregateFake.confirmFakeProviderBillingOrderCheckout({ authenticatedUserId: raceFixture.ownerId, confirmationToken: sameOrderConcurrent[0].confirmationToken }, new Date(raceFixture.now.getTime() + 2000)),
        aggregateFake.confirmFakeProviderBillingOrderCheckout({ authenticatedUserId: raceFixture.ownerId, confirmationToken: sameOrderConcurrent[1].confirmationToken }, new Date(raceFixture.now.getTime() + 2000)),
      ]);
      assert.deepEqual(simultaneousConfirmations.map((result) => result.duplicate).sort(), [false, true], "concurrent confirmations settle once and replay once");
      const raceSubs = await v2Db.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions)
        .where(eq(schema.locationSubscriptions.locationId, raceFixture.locationId));
      assert.equal(raceSubs.length, 1, "concurrent provider confirmations create only one Subscription");
      const raceEvents = await v2Db.select({ id: schema.commercialPaymentEvents.id }).from(schema.commercialPaymentEvents)
        .where(eq(schema.commercialPaymentEvents.paymentId, racePayments[0].id));
      assert.equal(raceEvents.length, 1, "concurrent confirmation writes one provider event receipt");

      const priceEditAt = new Date(raceFixture.now.getTime() + 2500);
      const priceEditRequest = { authenticatedUserId: raceFixture.ownerId,
        organizationId: (await v2Db.select({ organizationId: schema.locations.organizationId }).from(schema.locations)
          .where(eq(schema.locations.id, raceFixture.locationId)).limit(1))[0].organizationId,
        lines: [{ locationId: raceFixture.locationId, productId: raceFixture.productId, durationMonths: 1 }] };
      const [priceQuotedOrder, editedProductRows] = await Promise.all([
        service.createPrepaidBillingOrder(priceEditRequest, { now: priceEditAt, env: process.env }),
        v2Db.update(schema.commercialProducts).set({ priceMinor: 150_000, updatedAt: priceEditAt })
          .where(eq(schema.commercialProducts.id, raceFixture.productId)).returning({ priceMinor: schema.commercialProducts.priceMinor }),
      ]);
      assert.equal(editedProductRows[0]?.priceMinor, 150_000);
      assert.ok(["108000", "150000"].includes(priceQuotedOrder.lines[0].amountMinor),
        "concurrent price edit and quote observe one complete serialized catalog value");
      const priceEditCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
        authenticatedUserId: raceFixture.ownerId, billingOrderId: priceQuotedOrder.id,
      }, priceEditAt);
      assert.equal(priceEditCheckout.amountMinor, Number(priceQuotedOrder.lines[0].amountMinor),
        "checkout preserves the concurrent quote's saved Product price");
      const priceEditSettlement = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
        authenticatedUserId: raceFixture.ownerId, confirmationToken: priceEditCheckout.confirmationToken,
      }, new Date(priceEditAt.getTime() + 1000));
      assert.equal(priceEditSettlement.allocations.length, 1, "the price snapshot settles to one Location/Product entitlement period");
      const distinctOrders = await v2Db.transaction(async (tx) => {
        const [location] = await tx.select({ organizationId: schema.locations.organizationId }).from(schema.locations)
          .where(eq(schema.locations.id, raceFixture.locationId)).limit(1);
        const request = { authenticatedUserId: raceFixture.ownerId, organizationId: location.organizationId,
          lines: [{ locationId: raceFixture.locationId, productId: raceFixture.productId, durationMonths: 1 }] };
        const drafts = [
          await service.createPrepaidBillingOrder(request, { db: tx, now: new Date(raceFixture.now.getTime() + 3000), env: process.env }),
          await service.createPrepaidBillingOrder(request, { db: tx, now: new Date(raceFixture.now.getTime() + 3000), env: process.env }),
        ];
        const settlementRows = [];
        for (const draft of drafts) {
          const [orderRow] = await tx.select().from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, draft.id));
          const lines = await tx.select().from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, draft.id));
          const paymentKey = `concurrent-success:${draft.id}`;
          const [payment] = await tx.insert(schema.commercialPayments).values({
            billingOrderId: draft.id, providerCode: orderRow.providerCode, paymentKey,
            externalPaymentId: `concurrent-external:${draft.id}`, status: "pending", amountMinor: orderRow.totalAmountMinor,
            currency: orderRow.currency, createdAt: raceFixture.now, updatedAt: raceFixture.now,
          }).returning();
          await tx.insert(schema.commercialPaymentAllocations).values(lines.map((line) => ({
            orderId: draft.id, paymentId: payment.id, orderLineId: line.id, amountMinor: line.amountMinor, createdAt: raceFixture.now,
          })));
          await tx.update(schema.commercialBillingOrders).set({ status: "pending", quotedAt: raceFixture.now,
            expiresAt: new Date(raceFixture.now.getTime() + 7 * 24 * 60 * 60_000),
            quoteReference: billingOrderModel.billingOrderSnapshotReference(orderRow, lines), updatedAt: raceFixture.now,
          }).where(eq(schema.commercialBillingOrders.id, draft.id));
          settlementRows.push({ orderId: draft.id, paymentId: payment.id, providerCode: orderRow.providerCode, paymentKey,
            externalPaymentId: `concurrent-external:${draft.id}`, amountMinor: orderRow.totalAmountMinor, currency: orderRow.currency });
        }
        return settlementRows;
      });
      const distinctSettlements = await Promise.all(distinctOrders.map((row, index) => paymentLifecycle.settleTrustedBillingOrderPayment({
        ...row, idempotencyKey: `concurrent-event:${index}:${row.orderId}`, externalEventId: `concurrent-event:${index}:${row.orderId}`,
        occurredAt: new Date(raceFixture.now.getTime() + 4000),
      })));
      assert.deepEqual(distinctSettlements.map((result) => result.duplicate), [false, false], "distinct concurrent successful payments both settle");
      const distinctLines = await v2Db.select({
        orderId: schema.commercialBillingOrderLines.orderId,
        startsAt: schema.commercialBillingOrderLines.billingPeriodStartsAt,
        endsAt: schema.commercialBillingOrderLines.billingPeriodEndsAt,
      }).from(schema.commercialBillingOrderLines).where(inArray(schema.commercialBillingOrderLines.orderId, distinctOrders.map((row) => row.orderId)))
        .orderBy(schema.commercialBillingOrderLines.billingPeriodStartsAt);
      assert.equal(distinctLines.length, 2);
      assert.equal(distinctLines[1].startsAt?.toISOString(), distinctLines[0].endsAt?.toISOString(), "distinct concurrent purchases receive contiguous periods");
      assert.equal((await v2Db.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions)
        .where(eq(schema.locationSubscriptions.locationId, raceFixture.locationId))).length, 1, "distinct prepaid periods extend the same product subscription");

      const manualInvoice = await service.createManualBankTransferBillingOrder({
        organizationId: (await v2Db.select({ organizationId: schema.locations.organizationId }).from(schema.locations)
          .where(eq(schema.locations.id, raceFixture.locationId)).limit(1))[0].organizationId,
        operatorAuthorization: manualOperatorAuthorization, reason: "Approved concurrent bank settlement test",
        idempotencyKey: `manual-race-${raceSuffix.slice(0, 24)}`, periodStart: "2030-06-01", durationMonths: 1,
        currency: "RUB", totalAmountMinor: "30000", invoiceNumber: `RACE-${raceSuffix.slice(0, 12)}`,
        invoiceIssuedAt: "2030-05-15", paymentDueAt: "2030-05-22",
        lines: raceFixture.locationIds.map((locationId) => ({ locationId, productId: raceFixture.productId })),
      });
      assert.equal(manualInvoice.duplicate, false);
      const confirmInput = { orderId: manualInvoice.id, operatorAuthorization: manualOperatorAuthorization, amountMinor: "30000", currency: "RUB",
        bankTransactionReference: `BANK-${raceSuffix}`, actualPaymentDate: "2030-05-20", reason: "Verified full bank transfer receipt" };
      const manualConfirmNow = new Date("2030-05-21T12:00:00.000Z");
      await assert.rejects(manualBillingAdmin.confirmManualBankTransferPayment({ ...confirmInput, amountMinor: "29999" }, { now: manualConfirmNow }),
        (error: unknown) => error instanceof manualBillingAdmin.ManualBillingAdminError && error.code === "payment_conflict",
        "partial payment is rejected before settlement");
      await assert.rejects(manualBillingAdmin.confirmManualBankTransferPayment({ ...confirmInput, currency: "USD" }, { now: manualConfirmNow }),
        (error: unknown) => error instanceof manualBillingAdmin.ManualBillingAdminError && error.code === "payment_conflict",
        "currency mismatch is rejected before settlement");
      await assert.rejects(manualBillingAdmin.confirmManualBankTransferPayment({ ...confirmInput, operatorAuthorization: "Basic invalid" }),
        (error: unknown) => error instanceof manualBillingAdmin.ManualBillingAdminError && error.code === "not_authorized");
      await assert.rejects(manualBillingAdmin.confirmManualBankTransferPayment({ ...confirmInput, actualPaymentDate: "2030-05-22" }, { now: manualConfirmNow }),
        (error: unknown) => error instanceof manualBillingAdmin.ManualBillingAdminError && error.code === "invalid_input",
        "a future payment date cannot be used to grant access");
      const concurrentManualConfirmations = await Promise.all([
        manualBillingAdmin.confirmManualBankTransferPayment(confirmInput, { now: manualConfirmNow }),
        manualBillingAdmin.confirmManualBankTransferPayment(confirmInput, { now: manualConfirmNow }),
      ]);
      assert.deepEqual(concurrentManualConfirmations.map((result) => result.duplicate).sort(), [false, true],
        "concurrent confirmation of one bank reference settles and grants once");
      const manualLineStates = await v2Db.select({ subscriptionId: schema.commercialBillingOrderLines.subscriptionId,
        locationId: schema.commercialBillingOrderLines.locationId,
      }).from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, manualInvoice.id));
      assert.equal(manualLineStates.length, 3);
      assert.ok(manualLineStates.every((line) => line.subscriptionId), "the single payment grants all three salon subscriptions atomically");
      assert.equal((await v2Db.select({ id: schema.commercialPaymentEvents.id }).from(schema.commercialPaymentEvents)
        .where(eq(schema.commercialPaymentEvents.paymentId, manualInvoice.paymentId!))).length, 1, "manual confirmation audit is written once");

      const secondManualInvoice = await service.createManualBankTransferBillingOrder({
        organizationId: (await v2Db.select({ organizationId: schema.locations.organizationId }).from(schema.locations)
          .where(eq(schema.locations.id, raceFixture.locationId)).limit(1))[0].organizationId,
        operatorAuthorization: manualOperatorAuthorization, reason: "Second period reference uniqueness test",
        idempotencyKey: `manual-race-next-${raceSuffix.slice(0, 18)}`, periodStart: "2030-07-01", durationMonths: 1,
        currency: "RUB", totalAmountMinor: "30000", invoiceNumber: `RACE-NEXT-${raceSuffix.slice(0, 10)}`,
        invoiceIssuedAt: "2030-06-15", paymentDueAt: "2030-06-22",
        lines: raceFixture.locationIds.map((locationId) => ({ locationId, productId: raceFixture.productId })),
      });
      await assert.rejects(manualBillingAdmin.confirmManualBankTransferPayment({ ...confirmInput, orderId: secondManualInvoice.id }, { now: manualConfirmNow }),
        (error: unknown) => error instanceof manualBillingAdmin.ManualBillingAdminError && error.code === "bank_reference_conflict",
        "a bank reference cannot be reused for a different payment");
      assertionCount += 27;
    } finally {
      if (raceOrganizationId) {
        await v2Db.transaction(async (tx) => {
          const orders = await tx.select({ id: schema.commercialBillingOrders.id }).from(schema.commercialBillingOrders)
            .where(eq(schema.commercialBillingOrders.organizationId, raceOrganizationId!));
          const orderIds = orders.map((order) => order.id);
          if (orderIds.length > 0) {
            const payments = await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)
              .where(inArray(schema.commercialPayments.billingOrderId, orderIds));
            const paymentIds = payments.map((payment) => payment.id);
            if (paymentIds.length > 0) {
              await tx.delete(schema.commercialPaymentAllocations).where(inArray(schema.commercialPaymentAllocations.paymentId, paymentIds));
              await tx.delete(schema.commercialPaymentEvents).where(inArray(schema.commercialPaymentEvents.paymentId, paymentIds));
            }
            await tx.delete(schema.commercialPayments).where(inArray(schema.commercialPayments.billingOrderId, orderIds));
            await tx.delete(schema.commercialBillingOrderLines).where(inArray(schema.commercialBillingOrderLines.orderId, orderIds));
            await tx.delete(schema.commercialBillingOrders).where(inArray(schema.commercialBillingOrders.id, orderIds));
          }
          const raceLocations = await tx.select({ id: schema.locations.id }).from(schema.locations)
            .where(eq(schema.locations.organizationId, raceOrganizationId!));
          const raceLocationIds = raceLocations.map((location) => location.id);
          if (raceLocationIds.length > 0) await tx.delete(schema.locationSubscriptions).where(inArray(schema.locationSubscriptions.locationId, raceLocationIds));
          const raceProducts = await tx.select({ id: schema.commercialProducts.id }).from(schema.commercialProducts)
            .where(eq(schema.commercialProducts.code, `billing-race-${raceSuffix}`));
          const raceProductIds = raceProducts.map((product) => product.id);
          if (raceProductIds.length > 0) await tx.delete(schema.commercialPaymentRoutes).where(inArray(schema.commercialPaymentRoutes.productId, raceProductIds));
          await tx.delete(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, raceOrganizationId!));
          await tx.delete(schema.locations).where(eq(schema.locations.organizationId, raceOrganizationId!));
          if (raceProductIds.length > 0) await tx.delete(schema.commercialProducts).where(inArray(schema.commercialProducts.id, raceProductIds));
          await tx.delete(schema.organizations).where(eq(schema.organizations.id, raceOrganizationId!));
          await tx.delete(schema.users).where(eq(schema.users.email, `billing-race-${raceSuffix}@example.test`));
          await tx.delete(schema.commercialPaymentProviders).where(eq(schema.commercialPaymentProviders.code, "fake-staging"));
        });
      }
    }
    const finalCounts = await v2Pool.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) + (SELECT count(*) FROM commercial_product_visibility_events) + (SELECT count(*) FROM commercial_payment_providers WHERE code <> 'manual-bank-transfer') + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_payment_route_events) + (SELECT count(*) FROM commercial_billing_resets) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_billing_order_lines) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_events) + (SELECT count(*) FROM commercial_payment_allocations) + (SELECT count(*) FROM gift_access_invitations) + (SELECT count(*) FROM organization_channel_gift_grants) AS count",
    );
    assert.equal(finalCounts.rows[0]?.count, "0", "rollback and concurrent fixtures are fully removed");
    assertionCount += 1;
    console.info(`Billing Order rollback-isolated integration PASS (${assertionCount} assertions); committed concurrency fixtures cleaned and counts verified zero.`);
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
