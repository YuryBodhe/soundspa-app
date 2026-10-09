import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID, createHash } from "node:crypto";

let closeTestPool: (() => Promise<void>) | undefined;

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl || process.env.V2_BILLING_RESET_TEST_ALLOW_DATABASE !== "1") {
    throw new Error("Refusing billing-reset integration test: explicit disposable database opt-in is required.");
  }
  const target = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(target.hostname) || decodeURIComponent(target.pathname) !== "/soundspa_v2" ||
      decodeURIComponent(target.username) !== "soundspa_v2_test" || (target.port && target.port !== "5432")) {
    throw new Error("Refusing billing-reset integration test: require loopback soundspa_v2 with dedicated soundspa_v2_test role.");
  }

  const oldEnv = new Map(["V2_DEPLOYMENT_ENV", "V2_PUBLIC_ORIGIN", "V2_BILLING_RESET_TEST_ALLOW_DATABASE", "V2_ADMIN_USERNAME", "V2_ADMIN_PASSWORD", "V2_FAKE_PROVIDER_ENABLED", "V2_FAKE_PROVIDER_SECRET"]
    .map((key) => [key, process.env[key]]));
  process.env.V2_DEPLOYMENT_ENV = "staging";
  process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.bodhemusic.com";
  process.env.V2_BILLING_RESET_TEST_ALLOW_DATABASE = "1";
  process.env.V2_ADMIN_USERNAME = "billing-reset-test-operator";
  process.env.V2_ADMIN_PASSWORD = "local-integration-only-operator-password";
  process.env.V2_FAKE_PROVIDER_ENABLED = "1";
  process.env.V2_FAKE_PROVIDER_SECRET = "local-only-fake-provider-secret-must-exceed-32-bytes";

  const [client, schema, billingOrders, aggregateFake, reset, access, gifts, billingRead] = await Promise.all([
    import("../../db/v2/client"), import("../../db/v2/schema"), import("../../db/v2/services/billingOrders"),
    import("../../db/v2/services/fakeBillingOrderProvider"),
    import("../../db/v2/services/billingReset"), import("../../db/v2/queries/effectiveAccess"),
    import("../../db/v2/services/giftAccess"), import("../../db/v2/services/billingOrderRead"),
  ]);
  const { v2Db, v2Pool } = client;
  closeTestPool = () => v2Pool.end();
  const authorization = `Basic ${Buffer.from(`${process.env.V2_ADMIN_USERNAME}:${process.env.V2_ADMIN_PASSWORD}`).toString("base64")}`;
  const dbIdentity = await v2Pool.query<{ database: string; role: string; address: string | null; port: number; version: string; migrationCount: string; latest: string }>(
    "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port, current_setting('server_version_num') AS version, (SELECT count(*)::text FROM drizzle_v2.__drizzle_migrations) AS \"migrationCount\", (SELECT max(created_at)::text FROM drizzle_v2.__drizzle_migrations) AS latest",
  );
  const identity = dbIdentity.rows[0];
  const address = identity?.address?.split("/")[0] ?? "";
  if (!identity || identity.database !== "soundspa_v2" || identity.role !== "soundspa_v2_test" || identity.port !== 5432 ||
      !new Set(["127.0.0.1", "::1"]).has(address) || isIP(address) === 0 ||
      !identity.version.startsWith("16") || Number(identity.migrationCount) !== 19 || identity.latest !== "1791547650457") {
    throw new Error("Refusing billing-reset integration test: disposable PostgreSQL identity or migration ledger mismatch.");
  }
  const baseline = await v2Pool.query<{ count: string }>(
    "SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM locations) + (SELECT count(*) FROM commercial_products) + (SELECT count(*) FROM commercial_billing_orders) + (SELECT count(*) FROM commercial_payments) + (SELECT count(*) FROM location_subscriptions) + (SELECT count(*) FROM location_core_trials) + (SELECT count(*) FROM location_service_access) + (SELECT count(*) FROM commercial_partner_benefits) + (SELECT count(*) FROM gift_access_invitations) + (SELECT count(*) FROM organization_channel_gift_grants) + (SELECT count(*) FROM location_channel_grants) AS count",
  );
  if (baseline.rows[0]?.count !== "0") throw new Error("Disposable billing-reset database must start without fixtures.");

  let assertionCount = 0;
  const check = (condition: unknown, message: string) => { assert.ok(condition, message); assertionCount += 1; };
  const now = new Date();
  const suffix = randomUUID();
  const [org] = await v2Db.insert(schema.organizations).values({ name: `reset-${suffix}` }).returning();
  const [owner] = await v2Db.insert(schema.users).values({ email: `reset-${suffix}@example.test`, emailVerifiedAt: now }).returning();
  await v2Db.insert(schema.organizationMembers).values({ organizationId: org.id, userId: owner.id, role: "owner" });
  const [targetLocation, otherLocation, legacyLocation] = await v2Db.insert(schema.locations).values([
    { organizationId: org.id, name: "Hamam", slug: `reset-hamam-${suffix}`, timezone: "Europe/Moscow", marketCode: "RU" },
    { organizationId: org.id, name: "Other Location", slug: `reset-other-${suffix}`, timezone: "Europe/Moscow", marketCode: "RU" },
    { organizationId: org.id, name: "Legacy Access Location", slug: `reset-legacy-${suffix}`, timezone: "Europe/Moscow", marketCode: "RU" },
  ]).returning();
  const [basic, otherProduct, partnerProduct] = await v2Db.insert(schema.commercialProducts).values([
    { code: "soundspa", name: "SoundSpa Basic", kind: "core", priceMinor: 108000, currency: "RUB", billingIntervalMonths: 1 },
    { code: `other-${suffix}`, name: "Other Product", kind: "core", priceMinor: 1000, currency: "RUB", billingIntervalMonths: 1 },
    { code: `partner-${suffix}`, name: "Partner Product", kind: "partner" },
  ]).returning();
  const [provider] = await v2Db.insert(schema.commercialPaymentProviders).values({ code: "fake-staging", displayName: "Fake Provider", isEnabled: true }).returning();
  await v2Db.insert(schema.commercialPaymentRoutes).values({
    marketCode: "RU", productId: basic.id, providerCode: provider.code, externalReference: `reset-basic-${suffix}`, isEnabled: true,
  }).returning();
  await v2Db.insert(schema.commercialPaymentRoutes).values({
    marketCode: "RU", productId: otherProduct.id, providerCode: provider.code, externalReference: `reset-other-${suffix}`, isEnabled: true,
  });
  const [basicChannel, otherChannel, partnerChannel, adminChannel] = await v2Db.insert(schema.channels).values([
    { slug: `reset-basic-${suffix}`, displayName: "Reset Basic", kind: "music", isPublished: true },
    { slug: `reset-other-${suffix}`, displayName: "Reset Other", kind: "music", isPublished: true },
    { slug: `reset-partner-${suffix}`, displayName: "Reset Partner", kind: "music", isPublished: true },
    { slug: `reset-admin-${suffix}`, displayName: "Reset Admin", kind: "music", isPublished: true },
  ]).returning();
  await v2Db.insert(schema.commercialProductChannels).values([
    { productId: basic.id, channelId: basicChannel.id }, { productId: otherProduct.id, channelId: otherChannel.id },
    { productId: partnerProduct.id, channelId: partnerChannel.id },
  ]);
  const oldEnd = new Date(now.getTime() + 10 * 86_400_000);
  const [paidSubscription] = await v2Db.insert(schema.locationSubscriptions).values({
    locationId: targetLocation.id, productId: basic.id, provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 20 * 86_400_000), currentPeriodEndsAt: oldEnd,
  }).returning();
  const [excludedOtherProductSubscription] = await v2Db.insert(schema.locationSubscriptions).values({
    locationId: targetLocation.id, productId: otherProduct.id, provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 2 * 86_400_000), currentPeriodEndsAt: new Date(now.getTime() + 20 * 86_400_000),
  }).returning();
  await v2Db.insert(schema.locationSubscriptions).values({
    locationId: otherLocation.id, productId: basic.id, provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 2 * 86_400_000), currentPeriodEndsAt: new Date(now.getTime() + 20 * 86_400_000),
  });
  const [legacyBasicSubscription] = await v2Db.insert(schema.locationSubscriptions).values({
    locationId: legacyLocation.id, productId: basic.id, provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 2 * 86_400_000), currentPeriodEndsAt: new Date(now.getTime() + 20 * 86_400_000),
  }).returning();
  const [legacyOtherSubscription] = await v2Db.insert(schema.locationSubscriptions).values({
    locationId: legacyLocation.id, productId: otherProduct.id, provider: provider.code, status: "active", startsAt: new Date(now.getTime() - 2 * 86_400_000), currentPeriodEndsAt: new Date(now.getTime() + 20 * 86_400_000),
  }).returning();
  const legacyTrialEndsAt = new Date(now.getTime() + 20 * 86_400_000);
  const legacyPaidThrough = new Date(now.getTime() + 30 * 86_400_000);
  const [legacyServiceAccess] = await v2Db.insert(schema.locationServiceAccess).values({
    locationId: legacyLocation.id, trialEndsAt: legacyTrialEndsAt, paidThrough: legacyPaidThrough,
  }).returning();
  const [oldTrial] = await v2Db.insert(schema.locationCoreTrials).values({
    locationId: targetLocation.id, productId: basic.id, status: "active", startsAt: new Date(now.getTime() - 5 * 86_400_000), endsAt: new Date(now.getTime() + 25 * 86_400_000),
  }).returning();
  const [partner] = await v2Db.insert(schema.commercialPartners).values({ code: `reset-partner-${suffix}`, name: "Reset Partner" }).returning();
  const [benefit] = await v2Db.insert(schema.commercialPartnerBenefits).values({ partnerId: partner.id, productId: partnerProduct.id, locationId: targetLocation.id, startsAt: new Date(now.getTime() - 1_000), endsAt: null }).returning();
  const [adminGrant] = await v2Db.insert(schema.locationChannelGrants).values({ locationId: targetLocation.id, channelId: adminChannel.id, source: "admin", enabled: true }).returning();
  const tokenHash = createHash("sha256").update(suffix).digest("hex");
  const [giftInvite] = await v2Db.insert(schema.giftAccessInvitations).values({
    tokenHash, channelId: partnerChannel.id, duration: "3_months", durationMonths: 3, createdByOperator: "integration-test",
    redeemedAt: now, redeemedOrganizationId: org.id, redeemedByUserId: owner.id,
  }).returning();
  const [giftGrant] = await v2Db.insert(schema.organizationChannelGiftGrants).values({
    invitationId: giftInvite.id, organizationId: org.id, channelId: partnerChannel.id, redeemedByUserId: owner.id,
    duration: "3_months", durationMonths: 3, redeemedAt: now, startsAt: new Date(now.getTime() - 1_000), endsAt: new Date(now.getTime() + 90 * 86_400_000),
    billingAnchorDay: now.getUTCDate(), billingAnchorIsEndOfMonth: false,
  }).returning();

  // A paid order is retained in history; a second order remains pending and must be closed.
  const createOrder = async (locationId: string) => billingOrders.createPrepaidBillingOrder({
    authenticatedUserId: owner.id, organizationId: org.id, lines: [{ locationId, productId: basic.id, durationMonths: 1 }],
  }, { now, env: process.env });
  const paidDraft = await createOrder(targetLocation.id);
  const paidCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id, billingOrderId: paidDraft.id }, now);
  const paidCapability = new URL(paidCheckout.checkoutUrl).pathname.split("/").at(-1)!;
  check((await aggregateFake.confirmFakeBillingOrderAsPayer({ capability: paidCapability }, new Date(now.getTime() + 1))).state === "paid", "first billing order should settle successfully");
  const pendingDraft = await createOrder(targetLocation.id);
  const pendingCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id, billingOrderId: pendingDraft.id }, new Date(now.getTime() + 2));
  const pendingCapability = new URL(pendingCheckout.checkoutUrl).pathname.split("/").at(-1)!;
  const baselineSubscriptionEnd = (await v2Db.select({ currentPeriodEndsAt: schema.locationSubscriptions.currentPeriodEndsAt }).from(schema.locationSubscriptions).where((await import("drizzle-orm")).eq(schema.locationSubscriptions.id, paidSubscription.id)))[0].currentPeriodEndsAt;

  const input = {
    organizationId: org.id, locationId: targetLocation.id, productIds: [basic.id], trialProductId: basic.id,
    trialDurationDays: 30, reason: "Repeat SoundSpa staging acceptance test", operatorAuthorization: authorization,
  };
  const preview = await reset.previewStagingBillingReset(input, now);
  const unchanged = await v2Db.select({ id: schema.commercialBillingOrders.id, status: schema.commercialBillingOrders.status }).from(schema.commercialBillingOrders);
  check(unchanged.some((row) => row.id === pendingDraft.id && row.status === "pending"), "dry-run must not change pending order");
  check((await v2Db.select().from(schema.commercialBillingResets)).length === 0, "dry-run must not create reset audit rows");
  const productionEnv = process.env.V2_DEPLOYMENT_ENV;
  process.env.V2_DEPLOYMENT_ENV = "production";
  await assert.rejects(reset.previewStagingBillingReset(input, now), (error: unknown) => error instanceof reset.BillingResetError && error.code === "not_staging");
  process.env.V2_DEPLOYMENT_ENV = productionEnv;
  assertionCount += 2;
  await assert.rejects(reset.previewStagingBillingReset({ ...input, operatorAuthorization: "Basic invalid" }, now),
    (error: unknown) => error instanceof reset.BillingResetError && error.code === "not_authorized");
  assertionCount += 1;

  const confirmPhrase = `RESET V2 STAGING BILLING ${org.id} ${targetLocation.id}`;
  const applied = await reset.applyStagingBillingReset({ ...input, confirmationPhrase: confirmPhrase, expectedPlanHash: preview.planHash }, now);
  check(applied.mode === "applied", "reset should apply");
  check(applied.affectedRecords.subscriptions.includes(paidSubscription.id), "paid subscription should be invalidated by audit reference");
  check(applied.affectedRecords.trials.includes(oldTrial.id), "old trial should be invalidated by audit reference");
  check(applied.affectedRecords.ordersCanceled.includes(pendingDraft.id), "pending Fake checkout should be closed");
  check((await aggregateFake.confirmFakeBillingOrderAsPayer({ capability: pendingCapability }, new Date(now.getTime() + 3))).state === "canceled", "closed checkout must not settle later");

  const historicalOrder = await billingRead.getCustomerBillingOrder({ authenticatedUserId: owner.id, billingOrderId: paidDraft.id }, now);
  check(historicalOrder.status === "paid" && historicalOrder.payment?.status === "succeeded", "successful order/payment history remains available");
  const [historicalSubscription] = await v2Db.select().from(schema.locationSubscriptions).where((await import("drizzle-orm")).eq(schema.locationSubscriptions.id, paidSubscription.id));
  check(historicalSubscription.currentPeriodEndsAt?.getTime() === baselineSubscriptionEnd?.getTime(), "reset must not rewrite historical paid subscription dates");
  check(Boolean(historicalSubscription.invalidatedByResetId), "historical paid subscription is explicitly excluded from access");
  const [newTrial] = await v2Db.select().from(schema.locationCoreTrials).where((await import("drizzle-orm")).and(
    (await import("drizzle-orm")).eq(schema.locationCoreTrials.locationId, targetLocation.id),
    (await import("drizzle-orm")).eq(schema.locationCoreTrials.productId, basic.id),
    (await import("drizzle-orm")).isNull(schema.locationCoreTrials.invalidatedByResetId),
  ));
  check(newTrial.startsAt.getTime() === now.getTime() && newTrial.endsAt.getTime() === now.getTime() + 30 * 86_400_000, "fresh trial should have configured 30-day window");

  const accessBeforeRepeat = await access.resolveEffectiveChannelAccess(targetLocation.id, new Date(now.getTime() + 1_000));
  const source = (id: string) => accessBeforeRepeat.find((row) => row.id === id)?.accessSources ?? [];
  check(source(basicChannel.id).includes("trial") && !source(basicChannel.id).includes("subscription"), "invalidated paid entitlement must not grant access; fresh trial does");
  check(source(otherChannel.id).includes("subscription"), "unselected Product subscription remains effective");
  check(source(partnerChannel.id).includes("partner_benefit"), "Partner Benefit remains effective");
  check(source(adminChannel.id).includes("admin"), "Location Admin Grant remains effective");
  const activeGift = await gifts.getActiveOrganizationChannelGiftAccess(org.id, partnerChannel.id, now);
  check(activeGift?.kind === "finite" && activeGift.grantIds.includes(giftGrant.id), "Gift Access remains unchanged");
  const [unchangedBenefit] = await v2Db.select().from(schema.commercialPartnerBenefits).where((await import("drizzle-orm")).eq(schema.commercialPartnerBenefits.id, benefit.id));
  const [unchangedGrant] = await v2Db.select().from(schema.locationChannelGrants).where((await import("drizzle-orm")).eq(schema.locationChannelGrants.id, adminGrant.id));
  check(unchangedBenefit.updatedAt.getTime() === benefit.updatedAt.getTime() && unchangedGrant.updatedAt.getTime() === adminGrant.updatedAt.getTime(), "reset must not update Partner Benefit or Admin Grant");
  const [otherProductSubscription] = await v2Db.select().from(schema.locationSubscriptions).where((await import("drizzle-orm")).eq(schema.locationSubscriptions.id, excludedOtherProductSubscription.id));
  check(otherProductSubscription.invalidatedByResetId === null, "unselected Product subscription must remain unchanged");

  const legacyScopedInput = { ...input, locationId: legacyLocation.id, includeAllProducts: false };
  await assert.rejects(reset.previewStagingBillingReset(legacyScopedInput, new Date(now.getTime() + 90_000)),
    (error: unknown) => error instanceof reset.BillingResetError && error.code === "active_legacy_access_out_of_scope");
  assertionCount += 1;
  const allProductIds = [basic.id, otherProduct.id, partnerProduct.id].sort();
  const legacyAllInput = { ...legacyScopedInput, productIds: allProductIds, includeAllProducts: true, trialDurationDays: 14 };
  const legacyPreview = await reset.previewStagingBillingReset(legacyAllInput, new Date(now.getTime() + 90_000));
  check(legacyPreview.changes.legacyLocationAccessToClear !== null, "all-Product preview explicitly lists the unscoped commercial projection");
  const legacyApplied = await reset.applyStagingBillingReset({
    ...legacyAllInput, confirmationPhrase: `RESET V2 STAGING BILLING ${org.id} ${legacyLocation.id}`, expectedPlanHash: legacyPreview.planHash,
  }, new Date(now.getTime() + 90_000));
  const [legacyFreshTrial] = await v2Db.select().from(schema.locationCoreTrials).where((await import("drizzle-orm")).and(
    (await import("drizzle-orm")).eq(schema.locationCoreTrials.locationId, legacyLocation.id),
    (await import("drizzle-orm")).eq(schema.locationCoreTrials.productId, basic.id),
    (await import("drizzle-orm")).isNull(schema.locationCoreTrials.invalidatedByResetId),
  ));
  check(legacyFreshTrial.endsAt.getTime() - legacyFreshTrial.startsAt.getTime() === 14 * 86_400_000, "operator can choose a non-default trial duration");
  check(legacyApplied.affectedRecords.legacyLocationAccess?.paidThrough === legacyPaidThrough.toISOString(), "reset audit preserves the prior Location-wide paid projection value");
  const [clearedLegacyAccess] = await v2Db.select().from(schema.locationServiceAccess).where((await import("drizzle-orm")).eq(schema.locationServiceAccess.locationId, legacyLocation.id));
  check(clearedLegacyAccess.trialEndsAt === null && clearedLegacyAccess.paidThrough === null && clearedLegacyAccess.suspendedAt === legacyServiceAccess.suspendedAt,
    "all-Product reset clears only legacy billing timestamps and preserves other Location service settings");
  const [invalidatedLegacyOtherSubscription] = await v2Db.select().from(schema.locationSubscriptions).where((await import("drizzle-orm")).eq(schema.locationSubscriptions.id, legacyOtherSubscription.id));
  const [invalidatedLegacyBasicSubscription] = await v2Db.select().from(schema.locationSubscriptions).where((await import("drizzle-orm")).eq(schema.locationSubscriptions.id, legacyBasicSubscription.id));
  check(Boolean(invalidatedLegacyOtherSubscription.invalidatedByResetId) && Boolean(invalidatedLegacyBasicSubscription.invalidatedByResetId),
    "all-Product scope explicitly invalidates every selected Product subscription");

  const repeatPreview = await reset.previewStagingBillingReset(input, new Date(now.getTime() + 60_000));
  await reset.applyStagingBillingReset({ ...input, confirmationPhrase: confirmPhrase, expectedPlanHash: repeatPreview.planHash }, new Date(now.getTime() + 60_000));
  const activeTrials = await v2Db.select().from(schema.locationCoreTrials).where((await import("drizzle-orm")).and(
    (await import("drizzle-orm")).eq(schema.locationCoreTrials.locationId, targetLocation.id),
    (await import("drizzle-orm")).eq(schema.locationCoreTrials.productId, basic.id),
    (await import("drizzle-orm")).isNull(schema.locationCoreTrials.invalidatedByResetId),
  ));
  check(activeTrials.length === 1, "repeated reset leaves one effective trial, not accumulated active trial rows");
  check((await v2Db.select().from(schema.commercialBillingResets)).length === 3, "each applied reset is separately auditable");

  // Race one checkout confirmation against reset. Either reset closes the pending
  // payment first, or the successful settlement wins and reset requires a fresh preview.
  const raceInput = { ...input, locationId: otherLocation.id };
  const raceDraft = await createOrder(otherLocation.id);
  const raceCheckout = await aggregateFake.createFakeProviderBillingOrderCheckout({ authenticatedUserId: owner.id, billingOrderId: raceDraft.id }, new Date(now.getTime() + 120_000));
  const raceCapability = new URL(raceCheckout.checkoutUrl).pathname.split("/").at(-1)!;
  const racePreview = await reset.previewStagingBillingReset(raceInput, new Date(now.getTime() + 120_000));
  const [resetRace, paymentRace] = await Promise.allSettled([
    reset.applyStagingBillingReset({ ...raceInput, confirmationPhrase: `RESET V2 STAGING BILLING ${org.id} ${otherLocation.id}`, expectedPlanHash: racePreview.planHash }, new Date(now.getTime() + 120_000)),
    aggregateFake.confirmFakeBillingOrderAsPayer({ capability: raceCapability }, new Date(now.getTime() + 120_001)),
  ]);
  let raceResult = resetRace;
  if (resetRace.status === "rejected" && resetRace.reason instanceof reset.BillingResetError && resetRace.reason.code === "plan_changed") {
    const retryPreview = await reset.previewStagingBillingReset(raceInput, new Date(now.getTime() + 122_000));
    raceResult = await Promise.allSettled([reset.applyStagingBillingReset({
      ...raceInput, confirmationPhrase: `RESET V2 STAGING BILLING ${org.id} ${otherLocation.id}`, expectedPlanHash: retryPreview.planHash,
    }, new Date(now.getTime() + 122_000))]).then((rows) => rows[0]);
  }
  check(raceResult.status === "fulfilled", "reset/settlement race is serialized or retried from a fresh plan");
  check(paymentRace.status === "fulfilled", "provider result remains observable during concurrent reset");

  const counts = await v2Pool.query<{ resets: string; payments: string; orders: string }>(
    "SELECT (SELECT count(*)::text FROM commercial_billing_resets) AS resets, (SELECT count(*)::text FROM commercial_payments) AS payments, (SELECT count(*)::text FROM commercial_billing_orders) AS orders",
  );
  console.info(JSON.stringify({ postgres: "16", migrationCount: 19, assertions: assertionCount, resets: counts.rows[0]?.resets, orders: counts.rows[0]?.orders, payments: counts.rows[0]?.payments, race: "serialized-or-retried", result: "PASS" }));
  await v2Pool.end();
  closeTestPool = undefined;
  for (const [key, value] of oldEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

main().catch(async (error: unknown) => {
  await closeTestPool?.();
  closeTestPool = undefined;
  const candidate = error as { code?: unknown; message?: unknown };
  const raw = typeof candidate?.code === "string" ? candidate.code : typeof candidate?.message === "string" ? candidate.message : "billing_reset_test_failed";
  const code = /^[a-z0-9_-]{1,100}$/.test(raw) ? raw : "billing_reset_test_failed";
  const details = process.env.V2_BILLING_RESET_TEST_DEBUG === "1" && error instanceof Error
    ? error.stack?.split("\n").slice(0, 6).join("\n") : undefined;
  console.error(JSON.stringify({ result: "FAIL", error: code, ...(details ? { details } : {}) }));
  process.exitCode = 1;
});
