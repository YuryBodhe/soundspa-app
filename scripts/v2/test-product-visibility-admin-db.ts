import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertDisposableTarget(connectionString: string): URL {
  const target = new URL(connectionString);
  const role = decodeURIComponent(target.username);
  if (process.env.V2_PRODUCT_VISIBILITY_ADMIN_TEST_ALLOW_DATABASE !== "1" ||
      !new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname) ||
      decodeURIComponent(target.pathname) !== "/soundspa_v2" ||
      new Set(["soundspa_v2", "postgres", "root"]).has(role)) {
    throw new Error("Refusing Product Visibility Admin integration test: require explicit opt-in and a dedicated loopback soundspa_v2 database role.");
  }
  return target;
}

async function main() {
  const connectionString = process.env.V2_DATABASE_URL;
  if (!connectionString) throw new Error("V2_DATABASE_URL must target a disposable local PostgreSQL database.");
  const target = assertDisposableTarget(connectionString);
  const priorOperator = process.env.V2_ADMIN_USERNAME;
  const priorPassword = process.env.V2_ADMIN_PASSWORD;
  process.env.V2_ADMIN_USERNAME = `visibility-admin-test-${randomUUID().slice(0, 8)}`;
  process.env.V2_ADMIN_PASSWORD = `local-only-${randomUUID()}-operator-secret`;
  const operatorAuthorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;

  const [{ v2Db, v2Pool }, schema, visibilityAdmin, organizationDeletion, access] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/productVisibilityAdmin"),
    import("../../db/v2/services/organizationDeletion"),
    import("../../db/v2/queries/commercialAccess"),
  ]);

  let assertions = 0;
  const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertions += 1; };
  const rejectsCode = async (promise: Promise<unknown>, code: string) => {
    await assert.rejects(promise, (error: unknown) => error && typeof error === "object" && "code" in error && error.code === code);
    assertions += 1;
  };

  const ids = { organizations: [] as string[], products: [] as string[], locations: [] as string[], partner: "", channel: "", provider: "" };
  try {
    const identity = (await v2Pool.query<{
      database: string; role: string; address: string | null; version: string; migrations: number; latest: string;
    }>(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address,
      current_setting('server_version_num') AS version,
      (SELECT count(*)::int FROM drizzle_v2.__drizzle_migrations) AS migrations,
      (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest`)).rows[0];
    const address = identity?.address?.split("/")[0] ?? "";
    if (!identity || identity.database !== "soundspa_v2" || identity.role !== decodeURIComponent(target.username) ||
        new Set(["soundspa_v2", "postgres", "root"]).has(identity.role) || !identity.version.startsWith("16") ||
        isIP(address) === 0 || !new Set(["127.0.0.1", "::1"]).has(address) ||
        identity.migrations !== 21 || identity.latest !== "1791990342891") {
      throw new Error("Database identity did not match an isolated PostgreSQL 16 test database at migration 0020.");
    }
    const empty = (await v2Pool.query<{ count: string }>(`SELECT
      (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) +
      (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) +
      (SELECT count(*) FROM commercial_product_visibility_events) + (SELECT count(*) FROM commercial_billing_orders) +
      (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM location_subscriptions) +
      (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) +
      (SELECT count(*) FROM monitoring_lifecycle_events) AS count`)).rows[0];
    if (empty?.count !== "0") throw new Error("Disposable Product Visibility Admin database must start without customer or billing records.");

    const suffix = randomUUID();
    const now = new Date();
    await v2Db.transaction(async (tx) => {
      const orgs = await tx.insert(schema.organizations).values([
        { name: `visibility-admin-${suffix}` },
        { name: `visibility-admin-race-${suffix}` },
        { name: `visibility-admin-archived-${suffix}`, archivedAt: now },
        { name: `visibility-admin-delete-race-${suffix}` },
      ]).returning();
      ids.organizations.push(...orgs.map((item) => item.id));
      const [location] = await tx.insert(schema.locations).values({ organizationId: orgs[0].id,
        name: "Visibility Admin Test Location", slug: `visibility-admin-${suffix.slice(0, 12)}`, timezone: "UTC" }).returning();
      ids.locations.push(location.id);
      const [channel] = await tx.insert(schema.channels).values({ slug: `visibility-admin-${suffix.slice(0, 12)}`,
        displayName: "Visibility Admin Test Channel", kind: "music", isPublished: true }).returning();
      ids.channel = channel.id;
      const [product] = await tx.insert(schema.commercialProducts).values({ code: `visibility-admin-${suffix}`,
        name: "Visibility Admin Test Product", kind: "core", isActive: true, visibility: "public" }).returning();
      ids.products.push(product.id);
      await tx.insert(schema.commercialProductChannels).values({ productId: product.id, channelId: channel.id });
      const [provider] = await tx.insert(schema.commercialPaymentProviders).values({ code: `visibility-admin-${suffix.slice(0, 12)}`,
        displayName: "Local Product Visibility Test Provider", isEnabled: true }).returning();
      ids.provider = provider.code;
      const [partner] = await tx.insert(schema.commercialPartners).values({ code: `visibility-admin-${suffix}`,
        name: "Visibility Admin Test Partner", isActive: true }).returning();
      ids.partner = partner.id;
      await tx.insert(schema.locationCoreTrials).values({ locationId: location.id, productId: product.id, status: "active",
        startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 86_400_000) });
      await tx.insert(schema.locationSubscriptions).values({ locationId: location.id, productId: product.id,
        provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 60_000),
        currentPeriodEndsAt: new Date(now.getTime() + 30 * 86_400_000), billingAnchorDay: now.getUTCDate(),
        billingAnchorIsEndOfMonth: false, priceMinor: 108000, currency: "RUB" });
      await tx.insert(schema.commercialPartnerBenefits).values({ partnerId: partner.id, productId: product.id,
        locationId: location.id, startsAt: new Date(now.getTime() - 60_000), endsAt: null });
    });

    const [organizationId, raceOrganizationId, archivedOrganizationId] = ids.organizations;
    const deleteRaceOrganizationId = ids.organizations[3]!;
    const deleteRaceOrganizationName = `visibility-admin-delete-race-${suffix}`;
    const [productId] = ids.products;
    const locationId = ids.locations[0]!;
    check(UUID.test(organizationId!) && UUID.test(productId!), "test records use valid persisted IDs");

    const before = {
      trials: await v2Db.select().from(schema.locationCoreTrials),
      subscriptions: await v2Db.select().from(schema.locationSubscriptions),
      benefits: await v2Db.select().from(schema.commercialPartnerBenefits),
    };
    const beforeAccess = await access.resolveCommercialProductAccess(locationId, now);
    check(beforeAccess.get(ids.channel)?.has("trial"), "existing trial access resolves before visibility changes");
    check(beforeAccess.get(ids.channel)?.has("subscription"), "existing paid access resolves before visibility changes");
    check(beforeAccess.get(ids.channel)?.has("partner_benefit"), "Partner Benefit access resolves before visibility changes");

    await rejectsCode(visibilityAdmin.updateProductVisibility({ productId, visibility: "private", reason: "Switch to private visibility", confirmed: true, operatorAuthorization: "Basic invalid" }), "NOT_AUTHORIZED");
    await rejectsCode(visibilityAdmin.updateProductVisibility({ productId, visibility: "private", reason: "Switch to private visibility", confirmed: false, operatorAuthorization }), "CONFIRMATION_REQUIRED");
    await rejectsCode(visibilityAdmin.updateProductVisibility({ productId, visibility: "unknown", reason: "Switch to private visibility", confirmed: true, operatorAuthorization }), "INVALID_INPUT");
    const privateResult = await visibilityAdmin.updateProductVisibility({ productId, visibility: "private", reason: "Restrict new customer purchases", confirmed: true, operatorAuthorization });
    check(privateResult.changed && privateResult.visibility === "private", "operator can change public Product to private with confirmation");
    const duplicateNoOp = await visibilityAdmin.updateProductVisibility({ productId, visibility: "private", reason: "No additional visibility change", confirmed: true, operatorAuthorization });
    check(!duplicateNoOp.changed, "same visibility value is a no-op and does not add redundant audit history");
    await visibilityAdmin.updateProductVisibility({ productId, visibility: "disabled", reason: "Pause all new purchases", confirmed: true, operatorAuthorization });
    await visibilityAdmin.updateProductVisibility({ productId, visibility: "public", reason: "Restore public purchase access", confirmed: true, operatorAuthorization });

    const grant = await visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId, reason: "Approved private product access", operatorAuthorization });
    check(grant.grantedByOperator === process.env.V2_ADMIN_USERNAME, "grant operator identity comes from trusted server configuration");
    await rejectsCode(visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId, reason: "Duplicate authorization attempt", operatorAuthorization }), "AUTHORIZATION_EXISTS");
    await rejectsCode(visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId: "00000000-0000-4000-8000-000000000000", reason: "Unknown Organization test", operatorAuthorization }), "ORGANIZATION_NOT_FOUND");
    await rejectsCode(visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId: archivedOrganizationId, reason: "Archived Organization test", operatorAuthorization }), "ORGANIZATION_ARCHIVED");
    await rejectsCode(visibilityAdmin.revokeProductPurchaseAuthorization({ productId: "00000000-0000-4000-8000-000000000099", authorizationId: grant.id, reason: "Cross Product isolation test", confirmed: true, operatorAuthorization }), "AUTHORIZATION_NOT_FOUND");
    const revoked = await visibilityAdmin.revokeProductPurchaseAuthorization({ productId, authorizationId: grant.id, reason: "Authorization no longer needed", confirmed: true, operatorAuthorization });
    check(revoked.revokedByOperator === process.env.V2_ADMIN_USERNAME && revoked.revokeReason === "Authorization no longer needed", "revocation operator and reason are recorded");
    await rejectsCode(visibilityAdmin.revokeProductPurchaseAuthorization({ productId, authorizationId: grant.id, reason: "Repeat revocation attempt", confirmed: true, operatorAuthorization }), "AUTHORIZATION_REVOKED");
    const regrant = await visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId, reason: "Renew private product access", operatorAuthorization });
    check(regrant.id !== grant.id, "regrant creates a new history row rather than overwriting revoked history");

    const concurrent = await Promise.allSettled([
      visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId: raceOrganizationId, reason: "Concurrent authorization A", operatorAuthorization }),
      visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId: raceOrganizationId, reason: "Concurrent authorization B", operatorAuthorization }),
    ]);
    check(concurrent.filter((item) => item.status === "fulfilled").length === 1, "concurrent duplicate grants result in exactly one active grant");
    const rejectedConcurrent = concurrent.find((item) => item.status === "rejected");
    check(rejectedConcurrent?.status === "rejected" && rejectedConcurrent.reason?.code === "AUTHORIZATION_EXISTS", "concurrent duplicate grant receives a domain conflict");

    const revokeAndRegrant = await Promise.allSettled([
      visibilityAdmin.revokeProductPurchaseAuthorization({ productId, authorizationId: regrant.id,
        reason: "Concurrent revocation for regrant test", confirmed: true, operatorAuthorization }),
      visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId,
        reason: "Concurrent regrant attempt", operatorAuthorization }),
    ]);
    const concurrentRevoke = revokeAndRegrant[0];
    const concurrentRegrant = revokeAndRegrant[1];
    check(concurrentRevoke.status === "fulfilled", "concurrent revocation completes successfully");
    check(concurrentRegrant.status === "fulfilled" || (concurrentRegrant.status === "rejected" && concurrentRegrant.reason?.code === "AUTHORIZATION_EXISTS"),
      "concurrent regrant either follows revocation or receives a safe active-grant conflict");
    const concurrentGrantState = await v2Pool.query<{ active: string; total: string }>(
      "SELECT count(*) FILTER (WHERE revoked_at IS NULL)::text AS active, count(*)::text AS total FROM commercial_product_organization_authorizations WHERE organization_id = $1 AND product_id = $2",
      [organizationId, productId],
    );
    check(Number(concurrentGrantState.rows[0]?.active) <= 1 && Number(concurrentGrantState.rows[0]?.total) >= 2,
      "concurrent revoke/regrant preserves history without duplicate active grants");

    const deletionRace = await Promise.allSettled([
      organizationDeletion.deleteOrganization(deleteRaceOrganizationId, deleteRaceOrganizationName),
      visibilityAdmin.grantProductPurchaseAuthorization({ productId, organizationId: deleteRaceOrganizationId,
        reason: "Concurrent grant versus Organization deletion", operatorAuthorization }),
    ]);
    const deletionResult = deletionRace[0];
    const deletionGrantResult = deletionRace[1];
    if (deletionResult.status === "fulfilled") {
      check(deletionGrantResult.status === "rejected" && deletionGrantResult.reason?.code === "ORGANIZATION_NOT_FOUND",
        "grant cannot persist after concurrent Organization deletion");
      const leftovers = await v2Pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM commercial_product_organization_authorizations WHERE organization_id = $1", [deleteRaceOrganizationId],
      );
      check(leftovers.rows[0]?.count === "0", "Organization deletion leaves no orphaned grant history");
    } else {
      check(deletionResult.reason?.code === "product_authorization_history" && deletionGrantResult.status === "fulfilled",
        "grant winning the Organization lock causes deletion to preserve authorization history");
      const retained = await v2Pool.query<{ organizations: string; grants: string }>(
        "SELECT (SELECT count(*)::text FROM organizations WHERE id = $1) AS organizations, (SELECT count(*)::text FROM commercial_product_organization_authorizations WHERE organization_id = $1 AND revoked_at IS NULL) AS grants",
        [deleteRaceOrganizationId],
      );
      check(retained.rows[0]?.organizations === "1" && retained.rows[0]?.grants === "1",
        "Organization and active grant remain consistent when grant wins the lock");
    }

    await rejectsCode(visibilityAdmin.listProductAuthorizationManagementData(productId, "Basic invalid"), "NOT_AUTHORIZED");
    const management = await visibilityAdmin.listProductAuthorizationManagementData(productId, operatorAuthorization);
    check(management.organizations.some((item) => item.id === organizationId), "operator can view Organization authorization candidates");
    check(management.authorizations.filter((item) => item.organizationId === organizationId).length >= 2, "operator can inspect complete grant and revocation history after regrant races");
    check(management.authorizations.filter((item) => item.organizationId === organizationId && item.status === "active").length <= 1, "authorization view never reports duplicate active grants");
    const productManagement = await (await import("../../db/v2/services/productAdmin")).listProductManagementData();
    const productEntry = productManagement.products.find((item) => item.id === productId);
    check(productEntry?.visibility === "public" && productEntry.visibilityHistory.length === 3, "Product UI data exposes current visibility and operator change history");
    check(productEntry?.visibilityHistory.every((item) => item.operator === process.env.V2_ADMIN_USERNAME && item.reason.length >= 12), "visibility audit rows record the authenticated operator and reason");

    // Force the audit insert to fail and verify the Product update rolls back
    // with it. This trigger is confined to this explicitly disposable DB.
    const visibilityBeforeAuditFailure = (await v2Pool.query<{ visibility: string }>(
      "SELECT visibility FROM commercial_products WHERE id = $1", [productId],
    )).rows[0]?.visibility;
    const eventsBeforeAuditFailure = (await v2Pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM commercial_product_visibility_events WHERE product_id = $1", [productId],
    )).rows[0]?.count;
    await v2Pool.query(`CREATE FUNCTION visibility_admin_reject_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'intentional disposable audit failure'; END $$`);
    await v2Pool.query(`CREATE TRIGGER visibility_admin_reject_audit_insert BEFORE INSERT ON commercial_product_visibility_events
      FOR EACH ROW EXECUTE FUNCTION visibility_admin_reject_audit_insert()`);
    try {
      await assert.rejects(visibilityAdmin.updateProductVisibility({ productId, visibility: "private",
        reason: "Rollback when audit insert fails", confirmed: true, operatorAuthorization }));
      assertions += 1;
    } finally {
      await v2Pool.query("DROP TRIGGER IF EXISTS visibility_admin_reject_audit_insert ON commercial_product_visibility_events");
      await v2Pool.query("DROP FUNCTION IF EXISTS visibility_admin_reject_audit_insert()");
    }
    const afterAuditFailure = (await v2Pool.query<{ visibility: string }>(
      "SELECT visibility FROM commercial_products WHERE id = $1", [productId],
    )).rows[0]?.visibility;
    const eventsAfterAuditFailure = (await v2Pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM commercial_product_visibility_events WHERE product_id = $1", [productId],
    )).rows[0]?.count;
    check(afterAuditFailure === visibilityBeforeAuditFailure && eventsAfterAuditFailure === eventsBeforeAuditFailure,
      "visibility update rolls back atomically when audit event insertion fails");

    const accessAfter = await access.resolveCommercialProductAccess(locationId, new Date(now.getTime() + 1000));
    check(accessAfter.get(ids.channel)?.has("trial") && accessAfter.get(ids.channel)?.has("subscription") && accessAfter.get(ids.channel)?.has("partner_benefit"), "visibility and grant management leave all existing entitlement sources intact");
    assert.deepEqual(await v2Db.select().from(schema.locationCoreTrials), before.trials);
    assert.deepEqual(await v2Db.select().from(schema.locationSubscriptions), before.subscriptions);
    assert.deepEqual(await v2Db.select().from(schema.commercialPartnerBenefits), before.benefits);
    assertions += 3;

    await assert.rejects(organizationDeletion.deleteOrganization(organizationId, `visibility-admin-${suffix}`),
      (error: unknown) => error instanceof organizationDeletion.OrganizationDeletionError && error.code === "product_authorization_history");
    assertions += 1;
    check((await v2Db.select().from(schema.organizations).where((await import("drizzle-orm")).eq(schema.organizations.id, organizationId))).length === 1,
      "Organization remains intact when authorization history blocks deletion");
    check((await v2Db.select().from(schema.locations).where((await import("drizzle-orm")).eq(schema.locations.id, locationId))).length === 1,
      "Organization deletion is rejected before removing its Locations");
    const billingCount = await v2Pool.query<{ count: string }>("SELECT (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_payments) AS count");
    check(billingCount.rows[0]?.count === "0", "visibility and authorization administration creates no orders or payments");

    console.info(JSON.stringify({ postgres: 16, migrations: 21, assertions, result: "PASS" }));
  } finally {
    try {
      await v2Db.transaction(async (tx) => {
        if (ids.organizations.length) await tx.delete(schema.commercialProductOrganizationAuthorizations)
          .where((await import("drizzle-orm")).inArray(schema.commercialProductOrganizationAuthorizations.organizationId, ids.organizations));
        if (ids.organizations.length) await tx.delete(schema.monitoringLifecycleEvents)
          .where((await import("drizzle-orm")).inArray(schema.monitoringLifecycleEvents.organizationId, ids.organizations));
        if (ids.products.length) {
          await tx.delete(schema.commercialProductVisibilityEvents).where((await import("drizzle-orm")).inArray(schema.commercialProductVisibilityEvents.productId, ids.products));
          await tx.delete(schema.commercialPartnerBenefits).where((await import("drizzle-orm")).inArray(schema.commercialPartnerBenefits.productId, ids.products));
          await tx.delete(schema.locationCoreTrials).where((await import("drizzle-orm")).inArray(schema.locationCoreTrials.productId, ids.products));
          await tx.delete(schema.locationSubscriptions).where((await import("drizzle-orm")).inArray(schema.locationSubscriptions.productId, ids.products));
          await tx.delete(schema.commercialProductChannels).where((await import("drizzle-orm")).inArray(schema.commercialProductChannels.productId, ids.products));
          await tx.delete(schema.commercialProducts).where((await import("drizzle-orm")).inArray(schema.commercialProducts.id, ids.products));
        }
        if (ids.partner) await tx.delete(schema.commercialPartners).where((await import("drizzle-orm")).eq(schema.commercialPartners.id, ids.partner));
        if (ids.locations.length) await tx.delete(schema.locations).where((await import("drizzle-orm")).inArray(schema.locations.id, ids.locations));
        if (ids.organizations.length) await tx.delete(schema.organizations).where((await import("drizzle-orm")).inArray(schema.organizations.id, ids.organizations));
        if (ids.provider) await tx.delete(schema.commercialPaymentProviders).where((await import("drizzle-orm")).eq(schema.commercialPaymentProviders.code, ids.provider));
        if (ids.channel) await tx.delete(schema.channels).where((await import("drizzle-orm")).eq(schema.channels.id, ids.channel));
      });
      const remaining = await v2Pool.query<{ count: string }>(`SELECT
        (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) +
        (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_product_organization_authorizations) +
        (SELECT count(*) FROM commercial_product_visibility_events) + (SELECT count(*) FROM commercial_billing_orders) +
        (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM location_subscriptions) +
        (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM commercial_partner_benefits) +
        (SELECT count(*) FROM monitoring_lifecycle_events) AS count`);
      assert.equal(remaining.rows[0]?.count, "0", "all disposable Product Visibility Admin fixtures are removed");
    } finally {
      await v2Pool.end();
      if (priorOperator === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = priorOperator;
      if (priorPassword === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = priorPassword;
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Product Visibility Admin integration failed.");
  process.exitCode = 1;
});
