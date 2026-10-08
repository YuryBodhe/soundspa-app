import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

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

  const [{ v2Db, v2Pool }, schema, service, permissionService, customerBilling] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/billingOrders"),
    import("../../db/v2/services/locationBillingPermissions"),
    import("../../db/v2/services/customerBilling"),
  ]);
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

        const [unchangedSubscription] = await tx.select().from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.id, existingSubscription.id));
        assert.equal(unchangedSubscription.currentPeriodEndsAt?.toISOString(), "2026-10-31T10:00:00.000Z");
        assert.deepEqual(await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials), beforeTrials);
        assert.deepEqual(await tx.select({ id: schema.commercialPartnerBenefits.id }).from(schema.commercialPartnerBenefits), beforeBenefits);
        assert.equal((await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions)).length, beforeSubscriptions.length);
        assert.equal((await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments)).length, 0);
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
    console.info(`Billing Order rollback-only integration PASS (${assertionCount} assertions); fixture counts verified zero after rollback.`);
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
