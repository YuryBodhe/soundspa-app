import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

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

  const [{ v2Db, v2Pool }, schema, service, permissionService, customerBilling, aggregateFake, singleFake] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/billingOrders"),
    import("../../db/v2/services/locationBillingPermissions"),
    import("../../db/v2/services/customerBilling"),
    import("../../db/v2/services/fakeBillingOrderProvider"),
    import("../../db/v2/services/fakePaymentProvider"),
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
        expectedLocalRole === "soundspa_v2" || dbIdentity.role !== expectedLocalRole ||
        Number(dbIdentity.migrationCount) !== 17 || dbIdentity.latestMigration !== "1791461497519") {
      throw new Error("Database is not the expected disposable local database at Gate 6.3C.1 migration 0016.");
    }
    const baseline = await v2Pool.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM location_billing_permissions) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_payment_providers) + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_billing_order_lines) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_events) + (SELECT count(*) FROM commercial_payment_allocations) AS count",
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

        const locations = await tx.insert(schema.locations).values([1, 2, 3, 4].map((number) => ({
          organizationId: organization.id,
          name: `Billing order ${number}`,
          slug: `billing-order-${suffix.slice(0, 8)}-${number}`,
          timezone: "Europe/Moscow",
          marketCode: "RU",
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
          { code: `billing-order-basic-${suffix}`, name: "Billing Basic", kind: "core", priceMinor: 1, currency: "USD" },
          { code: `billing-order-partner-${suffix}`, name: "Billing Partner", kind: "partner" },
        ]).returning();
        const [provider] = await tx.insert(schema.commercialPaymentProviders).values({
          code: "fake-staging", displayName: "Staging Fake Provider", isEnabled: true,
        }).returning();
        const routes = await tx.insert(schema.commercialPaymentRoutes).values(products.map((product) => ({
          marketCode: "RU", productId: product.id, providerCode: provider.code,
          externalReference: `billing-order:${product.code}`,
        }))).returning();

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

        const beforeSubscriptions = await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions);
        const beforeTrials = await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials);
        const beforeBenefits = await tx.select({ id: schema.commercialPartnerBenefits.id }).from(schema.commercialPartnerBenefits);
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

        const order = await service.createPrepaidBillingOrder(input, { db: tx, now, env: process.env });
        assertionCount += 1;
        assert.equal(order.status, "draft");
        assert.equal(order.providerCode, "fake-staging");
        assert.equal(order.currency, "RUB");
        assert.equal(order.totalAmountMinor, "2268000");
        assert.deepEqual(order.lines.map((line) => line.amountMinor), ["108000", "216000", "648000", "1296000"]);
        assert.equal(order.lines[0].subscriptionId, existingSubscription.id);
        assert.equal(order.lines[0].billingPeriodStartsAt, "2026-10-31T10:00:00.000Z");
        assert.equal(order.lines[0].billingPeriodEndsAt, "2026-11-30T10:00:00.000Z");
        assert.equal(order.lines[1].billingPeriodStartsAt, now.toISOString());
        assert.equal(order.lines[1].billingPeriodEndsAt, "2026-12-08T10:00:00.000Z");
        assertionCount += 8;

        const persistedLines = await tx.select().from(schema.commercialBillingOrderLines).where(eq(schema.commercialBillingOrderLines.orderId, order.id));
        assert.equal(persistedLines.length, 4);
        assert.equal(persistedLines.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(2_268_000));
        const [persistedOrder] = await tx.select().from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, order.id));
        assert.equal(persistedOrder.status, "draft");
        assertionCount += 3;

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

        const changedPriceOrder = await service.createPrepaidBillingOrder({ ...input, lines: [input.lines[3]] }, {
          db: tx, now, env: process.env,
          pricingAdapters: [{ providerCode: "fake-staging", quote: ({ durationMonths }) => ({
            currency: "RUB", listAmountMinor: BigInt(108_001 * durationMonths), discountAmountMinor: BigInt(0),
          }) }],
        });
        await assertAggregateError(aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, billingOrderId: changedPriceOrder.id,
        }, now, tx), "order_stale");
        assertionCount += 4;

        const prepaidOrder = await service.createPrepaidBillingOrder({ ...input, lines: [
          { locationId: locations[0].id, productId: products[0].id, durationMonths: 1 },
          { locationId: locations[1].id, productId: products[0].id, durationMonths: 3 },
          { locationId: locations[2].id, productId: products[0].id, durationMonths: 12 },
        ] }, { db: tx, now, env: process.env });
        assert.equal(prepaidOrder.totalAmountMinor, "1728000", "one aggregate order is 17,280 RUB in integer minor units");
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
        assert.equal(new Date(aggregateCheckout.expiresAt).getTime() - now.getTime(), 7 * 24 * 60 * 60_000, "aggregate payer link expires after seven days");
        assert.match(aggregateCheckout.checkoutUrl, /^https:\/\/test\.soundspa\.bodhemusic\.com\/fake-checkout\//);
        const payerCapability = aggregateCheckout.checkoutUrl.split("/").pop()!;
        const retrievedLink = await aggregateFake.getFakeProviderBillingOrderCheckoutLink({
          authenticatedUserId: owner.id, billingOrderId: prepaidOrder.id,
        }, new Date(now.getTime() + 1500), tx);
        assert.equal(retrievedLink.checkoutUrl, aggregateCheckout.checkoutUrl, "authorized user can retrieve the valid deterministic link");
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

        const confirmationAt = new Date(now.getTime() + 3000);
        const settledAggregate = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: aggregateCheckout.confirmationToken,
        }, confirmationAt, tx);
        assert.equal(settledAggregate.duplicate, false);
        assert.equal(settledAggregate.allocations.length, 3);
        const repeatedSettlement = await aggregateFake.confirmFakeProviderBillingOrderCheckout({
          authenticatedUserId: owner.id, confirmationToken: aggregateCheckout.confirmationToken,
        }, new Date(confirmationAt.getTime() + 1000), tx);
        assert.equal(repeatedSettlement.duplicate, true, "repeated success callback cannot extend twice");
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
        assert.equal(paidByLocation.get(locations[1].id)?.periodEnd?.toISOString(), "2027-01-08T10:00:03.000Z", "three months follow the second Location's calendar anchor");
        assert.equal(paidByLocation.get(locations[2].id)?.periodEnd?.toISOString(), "2027-10-08T10:00:03.000Z", "twelve months follow the third Location's calendar anchor");
        assert.ok(paidLines.every((line) => line.providerRef === null), "prepaid lines do not create a renewal provider reference");
        const paidOrderView = await customerBilling.listCustomerBilling(owner.id, confirmationAt, tx);
        assert.equal(paidOrderView.locations.find((location) => location.id === locations[1].id)?.products.find((product) => product.productId === products[0].id)?.subscriptionId, null,
          "prepaid coverage does not expose a Cancel renewal action");
        const [paidOrder] = await tx.select({ status: schema.commercialBillingOrders.status }).from(schema.commercialBillingOrders).where(eq(schema.commercialBillingOrders.id, prepaidOrder.id));
        const [paidPayment] = await tx.select({ status: schema.commercialPayments.status }).from(schema.commercialPayments).where(eq(schema.commercialPayments.billingOrderId, prepaidOrder.id));
        assert.equal(paidOrder.status, "paid");
        assert.equal(paidPayment.status, "succeeded");

        await permissionService.grantLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: locations[0].id, managerUserId: manager.id,
        }, tx);
        const managerCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({
          authenticatedUserId: manager.id, billingOrderId: managerOrder.id,
        }, new Date(now.getTime() + 4000), tx);
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
        const paymentFoundation = await import("../../db/v2/services/paymentFoundation");
        await assert.rejects(lifecycle.settleTrustedBillingOrderPayment(conflictInput, tx),
          (error: unknown) => error instanceof paymentFoundation.PaymentFoundationError && error.code === "payment_identity_conflict");

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
        assert.equal((await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions)).length, beforeSubscriptions.length + 4);
        assert.equal((await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)).length, 7);
        assertionCount += 5;

        const routeSnapshot = await tx.select({ id: schema.commercialPaymentRoutes.id }).from(schema.commercialPaymentRoutes).where(and(
          eq(schema.commercialPaymentRoutes.id, routes[0].id), eq(schema.commercialPaymentRoutes.isEnabled, true),
        ));
        assert.equal(routeSnapshot.length, 1);
        assertionCount += 1;

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
      "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM location_billing_permissions) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_payment_providers) + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_billing_order_lines) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_events) + (SELECT count(*) FROM commercial_payment_allocations) AS count",
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
        const [location] = await tx.insert(schema.locations).values({
          organizationId: organization.id, name: "Concurrent checkout", slug: `billing-race-${raceSuffix.slice(0, 12)}`,
          timezone: "Europe/Moscow", marketCode: "RU",
        }).returning();
        const [product] = await tx.insert(schema.commercialProducts).values({
          code: `billing-race-${raceSuffix}`, name: "Concurrent checkout product", kind: "core", isActive: true,
        }).returning();
        const [raceProvider] = await tx.insert(schema.commercialPaymentProviders).values({ code: "fake-staging", displayName: "Staging Fake Provider", isEnabled: true }).returning();
        const [route] = await tx.insert(schema.commercialPaymentRoutes).values({
          marketCode: "RU", productId: product.id, providerCode: raceProvider.code,
          externalReference: `billing-race:${raceSuffix}`, isEnabled: true,
        }).returning();
        const requested = { authenticatedUserId: owner.id, organizationId: organization.id, lines: [{ locationId: location.id, productId: product.id, durationMonths: 1 }] };
        const first = await service.createPrepaidBillingOrder(requested, { db: tx, now: raceNow, env: process.env });
        const second = await service.createPrepaidBillingOrder(requested, { db: tx, now: raceNow, env: process.env });
        return { ownerId: owner.id, locationId: location.id, productId: product.id, routeId: route.id, firstId: first.id, secondId: second.id, now: raceNow };
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
      assertionCount += 8;
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
      "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_payment_providers) + (SELECT count(*) FROM commercial_payment_routes) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_billing_order_lines) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_events) + (SELECT count(*) FROM commercial_payment_allocations) AS count",
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
