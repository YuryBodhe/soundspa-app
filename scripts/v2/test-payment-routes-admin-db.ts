import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

// This integration run intentionally leaves immutable audit rows in its database.
// Run only on a disposable local PostgreSQL instance and discard that instance.

function assertDisposableLocalTarget(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  if (process.env.V2_PAYMENT_ROUTE_ADMIN_TEST_ALLOW_DATABASE !== "1" ||
      !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) ||
      decodeURIComponent(parsed.pathname) !== "/soundspa_v2") {
    throw new Error("Refusing Payment Route Admin integration test: require explicit opt-in and a loopback soundspa_v2 database.");
  }
  return parsed;
}

function databaseErrorContains(error: unknown, text: string): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { message?: unknown; cause?: unknown };
    if (typeof candidate.message === "string" && candidate.message.includes(text)) return true;
    current = candidate.cause;
  }
  return false;
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("V2_DATABASE_URL must target a disposable local PostgreSQL database.");
  const target = assertDisposableLocalTarget(databaseUrl);
  process.env.V2_DEPLOYMENT_ENV = "staging";
  process.env.V2_FAKE_PROVIDER_ENABLED = "1";
  process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.bodhemusic.com";
  process.env.V2_FAKE_PROVIDER_SECRET = "route-admin-test-only-secret-at-least-32-bytes";
  process.env.V2_ADMIN_USERNAME = "route-admin-test-operator";
  process.env.V2_ADMIN_PASSWORD = "route-admin-test-password";

  const [{ v2Db, v2Pool }, schema, admin] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/paymentRouteAdmin"),
  ]);
  let assertions = 0;
  try {
    const identity = await v2Pool.query<{ database: string; role: string; address: string | null; migrationCount: string; latestMigration: string }>(
      `SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
       (SELECT count(*) FROM drizzle_v2.__drizzle_migrations)::text AS "migrationCount",
       (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS "latestMigration"`,
    );
    const db = identity.rows[0];
    const address = db?.address?.split("/")[0] ?? "";
    if (!db || db.database !== "soundspa_v2" || !new Set(["127.0.0.1", "::1"]).has(address) || isIP(address) === 0 ||
        decodeURIComponent(target.username) !== "soundspa_v2_test" || db.role !== "soundspa_v2_test" ||
        Number(db.migrationCount) !== 22 || db.latestMigration !== "1792004696226") {
      throw new Error("Database is not a disposable loopback test database migrated through 0021.");
    }
    const baseline = await v2Pool.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) +
       (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_payment_routes) +
       (SELECT count(*) FROM commercial_payment_route_events) + (SELECT count(*) FROM commercial_billing_orders) +
       (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM location_subscriptions) +
       (SELECT count(*) FROM location_core_trials) AS count`,
    );
    if (baseline.rows[0]?.count !== "0") throw new Error("Disposable database must contain no customer, route, or billing test records.");

    const suffix = randomUUID();
    const [product] = await v2Db.insert(schema.commercialProducts).values({
      code: `route-admin-${suffix}`, name: "Route Admin Test Product", kind: "core", priceMinor: 108_000, currency: "RUB", billingIntervalMonths: 1,
    }).returning();
    const [otherProduct] = await v2Db.insert(schema.commercialProducts).values({
      code: `route-admin-other-${suffix}`, name: "Other Test Product", kind: "core", priceMinor: 108_000, currency: "RUB", billingIntervalMonths: 1,
    }).returning();
    const [insertedProvider] = await v2Db.insert(schema.commercialPaymentProviders).values({
      code: "fake-staging", displayName: "Test Fake Provider", isEnabled: true,
    }).onConflictDoNothing().returning();
    const [provider] = insertedProvider ? [insertedProvider] : await v2Db.select().from(schema.commercialPaymentProviders)
      .where(eq(schema.commercialPaymentProviders.code, "fake-staging")).limit(1);
    if (!provider) throw new Error("Fake Provider registry row is required for isolated route tests.");
    if (!provider.isEnabled) await v2Db.update(schema.commercialPaymentProviders).set({ isEnabled: true })
      .where(eq(schema.commercialPaymentProviders.code, "fake-staging"));
    const authorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;
    const reason = "Disposable integration test route change";
    const create = (externalReference: string, displayOrder = 0) => admin.createProductPaymentRoute({
      productId: product.id, marketCode: "RU", providerCode: provider.code, externalReference, displayOrder,
      reason, operatorAuthorization: authorization,
    });

    await assert.rejects(admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: null }),
      (error: unknown) => error instanceof admin.PaymentRouteAdminError && error.code === "NOT_AUTHORIZED");
    const first = await create(`route-admin:${suffix}:a`);
    assert.equal(first.route.isEnabled, false, "routes are created disabled");
    let view = await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization });
    assert.equal(view.routes.length, 1);
    assert.equal(view.routes[0].history.length, 1);
    assert.equal(view.routes[0].history[0].action, "created");
    assert.equal(view.routes[0].history[0].operator, process.env.V2_ADMIN_USERNAME);
    assert.equal(view.routes[0].history[0].reason, reason);
    assert.ok(view.routes[0].history[0].createdAt instanceof Date);
    assert.equal(view.routes[0].history[0].afterState.isEnabled, false);
    assertions += 7;

    const second = await create(`route-admin:${suffix}:b`, 0);
    const third = await create(`route-admin:${suffix}:c`, 10);
    view = await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization });
    assert.deepEqual(view.routes.map((route) => route.externalReference), [first.route.externalReference, second.route.externalReference, third.route.externalReference],
      "same provider/market can have multiple alternatives at tied and distinct priorities");
    await assert.rejects(create(first.route.externalReference),
      (error: unknown) => error instanceof admin.PaymentRouteAdminError && error.code === "ROUTE_IDENTITY_EXISTS");
    await assert.rejects(admin.updateProductPaymentRoute({
      productId: otherProduct.id, routeId: first.route.id, isEnabled: false, reason, operatorAuthorization: authorization,
    }), (error: unknown) => error instanceof admin.PaymentRouteAdminError && error.code === "ROUTE_NOT_FOUND");
    await assert.rejects(admin.updateProductPaymentRoute({
      productId: product.id, routeId: first.route.id, isEnabled: true, confirmed: false, reason, operatorAuthorization: authorization,
    }), (error: unknown) => error instanceof admin.PaymentRouteAdminError && error.code === "CONFIRMATION_REQUIRED");
    assertions += 5;

    const enabled = await admin.updateProductPaymentRoute({
      productId: product.id, routeId: first.route.id, isEnabled: true, confirmed: true, reason, operatorAuthorization: authorization,
    });
    assert.equal(enabled.route.isEnabled, true);
    const reprioritized = await admin.updateProductPaymentRoute({
      productId: product.id, routeId: first.route.id, displayOrder: 4, reason, operatorAuthorization: authorization,
    });
    assert.equal(reprioritized.route.displayOrder, 4);
    const disabled = await admin.updateProductPaymentRoute({
      productId: product.id, routeId: first.route.id, isEnabled: false, reason, operatorAuthorization: authorization,
    });
    assert.equal(disabled.route.isEnabled, false);
    assertions += 3;

    const beforeRace = (await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization })).routes
      .find((route) => route.id === first.route.id)!;
    const [raceA, raceB] = await Promise.all([
      admin.updateProductPaymentRoute({ productId: product.id, routeId: first.route.id, isEnabled: true, confirmed: true, reason, operatorAuthorization: authorization }),
      admin.updateProductPaymentRoute({ productId: product.id, routeId: first.route.id, displayOrder: 7, reason, operatorAuthorization: authorization }),
    ]);
    assert.equal(raceA.route.isEnabled, true);
    assert.equal(raceB.route.displayOrder, 7);
    const afterRace = (await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization })).routes
      .find((route) => route.id === first.route.id)!;
    assert.equal(afterRace.isEnabled, true);
    assert.equal(afterRace.displayOrder, 7, "concurrent updates to distinct route fields do not overwrite each other");
    const history = afterRace.history.slice().reverse();
    for (let index = 1; index < history.length; index++) assert.deepEqual(history[index].beforeState, history[index - 1].afterState,
      "serialized route audit states form a continuous before/after chain");
    assert.equal(history.length, beforeRace.history.length + 2);
    assertions += 5;

    const duplicateRace = await Promise.allSettled([create(`route-admin:${suffix}:race`), create(`route-admin:${suffix}:race`)]);
    assert.equal(duplicateRace.filter((result) => result.status === "fulfilled").length, 1, "concurrent duplicate route identities create exactly one route");
    assert.equal(duplicateRace.filter((result) => result.status === "rejected").length, 1);
    const afterDuplicateRace = (await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization })).routes;
    assert.equal(afterDuplicateRace.filter((route) => route.externalReference === `route-admin:${suffix}:race`).length, 1);
    assertions += 3;

    const functionName = `route_admin_reject_audit_${suffix.replaceAll("-", "")}`;
    const triggerName = `route_admin_reject_audit_trigger_${suffix.replaceAll("-", "")}`;
    try {
      await v2Pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$`);
      await v2Pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON commercial_payment_route_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      const beforeFailure = await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization });
      const priorEventCount = beforeFailure.routes.find((route) => route.id === first.route.id)!.history.length;
      await assert.rejects(admin.updateProductPaymentRoute({
        productId: product.id, routeId: first.route.id, isEnabled: false, reason, operatorAuthorization: authorization,
      }));
      const afterFailure = await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization });
      const failedRoute = afterFailure.routes.find((route) => route.id === first.route.id)!;
      assert.equal(failedRoute.isEnabled, true, "route update rolls back when audit insertion fails");
      assert.equal(failedRoute.history.length, priorEventCount, "failed atomic update leaves no audit event");
      assertions += 2;
    } finally {
      await v2Pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON commercial_payment_route_events`);
      await v2Pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    await assert.rejects(
      v2Db.update(schema.commercialPaymentRouteEvents).set({ reason: "Tampered audit reason" }),
      (error: unknown) => databaseErrorContains(error, "append-only"),
    );
    await assert.rejects(v2Pool.query("DELETE FROM commercial_payment_route_events"),
      (error: unknown) => databaseErrorContains(error, "append-only"));
    await assert.rejects(v2Db.update(schema.commercialPaymentRoutes).set({ externalReference: `mutated:${suffix}` })
      .where(eq(schema.commercialPaymentRoutes.id, first.route.id)),
      (error: unknown) => databaseErrorContains(error, "identity is immutable"));
    await assert.rejects(v2Pool.query("TRUNCATE commercial_payment_route_events"),
      (error: unknown) => databaseErrorContains(error, "append-only"));
    const finalRows = await admin.listProductPaymentRoutes({ productId: product.id, operatorAuthorization: authorization });
    assert.ok(finalRows.routes.find((route) => route.id === first.route.id)!.history.length >= 6, "all route audit history remains available");
    const untouchedBilling = await v2Pool.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM commercial_payment_allocations) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) AS count",
    );
    assert.equal(untouchedBilling.rows[0]?.count, "0", "route management creates no orders, payments, entitlements, subscriptions, or trials");
    assertions += 4;
    console.info(`Payment Route Admin disposable PostgreSQL integration PASS (${assertions} assertions). Discard the test database after the run; append-only audit fixtures are intentionally retained.`);
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
