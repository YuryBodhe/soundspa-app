import assert from "node:assert/strict";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

class Rollback extends Error {}

function assertAllowedDatabaseTarget(databaseUrl: string): "local" | "staging-v2" {
  const parsed = new URL(databaseUrl);
  const target = process.env.V2_FAKE_PROVIDER_TEST_TARGET;
  if (target === "staging-v2") {
    if (parsed.hostname !== "v2-postgres" || (parsed.port && parsed.port !== "5432") || parsed.pathname !== "/soundspa_v2" || decodeURIComponent(parsed.username) !== "soundspa_v2") {
      throw new Error("Staging DB test requires the exact V2 Compose service, database, and role identity.");
    }
    return "staging-v2";
  }
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
    throw new Error("Refusing remote DB test without the exact staging target opt-in and identity checks.");
  }
  return "local";
}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("V2_DATABASE_URL is required for the rollback-only Fake Provider test.");
  const target = assertAllowedDatabaseTarget(databaseUrl);

  const oldEnv = new Map(["V2_DEPLOYMENT_ENV", "V2_FAKE_PROVIDER_ENABLED", "V2_FAKE_PROVIDER_SECRET", "V2_PUBLIC_ORIGIN"].map((key) => [key, process.env[key]]));
  process.env.V2_DEPLOYMENT_ENV = "staging";
  process.env.V2_FAKE_PROVIDER_ENABLED = "1";
  process.env.V2_FAKE_PROVIDER_SECRET = "rollback-only-test-secret-that-is-at-least-32-bytes";
  process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.bodhemusic.com";

  let closePool: (() => Promise<void>) | undefined;
  let organizationId: string | null = null;
  let acceptanceEmail: string | null = null;
  try {
    const { v2Db, v2Pool } = await import("../../db/v2/client");
    closePool = () => v2Pool.end();
    if (target === "staging-v2") {
      const identity = await v2Pool.query<{ database: string; address: string | null; port: number; role: string; journal: boolean; payment_events: boolean }>(
        "SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port, current_user AS role, to_regclass('drizzle_v2.__drizzle_migrations') IS NOT NULL AS journal, to_regclass('public.commercial_payment_events') IS NOT NULL AS payment_events",
      );
      const db = identity.rows[0];
      const addressText = db?.address?.split("/")[0] ?? "";
      const address = addressText.split(".").map(Number);
      const privateAddress = isIP(addressText) === 4 && address.length === 4 && (
        address[0] === 10 || (address[0] === 172 && address[1] >= 16 && address[1] <= 31) ||
        (address[0] === 192 && address[1] === 168)
      );
      if (!db || db.database !== "soundspa_v2" || db.role !== "soundspa_v2" || db.port !== 5432 || !privateAddress || !db.journal || !db.payment_events) {
        throw new Error("Connected database does not match the verified V2 staging identity.");
      }
      console.info("Verified V2 staging database identity: soundspa_v2 over the private Docker network.");
    }
    const configuredLocationId = process.env.V2_FAKE_PROVIDER_TEST_LOCATION_ID;
    const configuredRouteId = process.env.V2_FAKE_PROVIDER_TEST_ROUTE_ID;
    if (target === "staging-v2" && (!configuredLocationId || !configuredRouteId)) {
      throw new Error("Staging test requires the isolated Fake Provider Location and Route IDs from its setup step.");
    }
    const [schema, fakeProvider, paymentHelpers, access, billingPermissions] = await Promise.all([
      import("../../db/v2/schema"),
      import("../../db/v2/services/fakePaymentProvider"),
      import("../../lib/v2/fakePaymentProvider"),
      import("../../db/v2/queries/effectiveAccess"),
      import("../../db/v2/services/locationBillingPermissions"),
    ]);
    try {
      await v2Db.transaction(async (tx) => {
        const suffix = randomUUID();
        const now = new Date();
        const emailVerifiedAt = new Date(now.getTime() - 1000);
        if (target === "staging-v2") {
          const [acceptance] = await tx.select({
            locationId: schema.locations.id,
            organizationId: schema.locations.organizationId,
            marketCode: schema.locations.marketCode,
            locationArchivedAt: schema.locations.archivedAt,
            organizationArchivedAt: schema.organizations.archivedAt,
            organizationName: schema.organizations.name,
            routeId: schema.commercialPaymentRoutes.id,
            routeMarket: schema.commercialPaymentRoutes.marketCode,
            routeEnabled: schema.commercialPaymentRoutes.isEnabled,
            routeProduct: schema.commercialProducts.id,
            productCode: schema.commercialProducts.code,
            productActive: schema.commercialProducts.isActive,
            providerCode: schema.commercialPaymentProviders.code,
            providerEnabled: schema.commercialPaymentProviders.isEnabled,
          }).from(schema.locations)
            .innerJoin(schema.organizations, eq(schema.organizations.id, schema.locations.organizationId))
            .innerJoin(schema.commercialPaymentRoutes, eq(schema.commercialPaymentRoutes.id, configuredRouteId!))
            .innerJoin(schema.commercialProducts, eq(schema.commercialProducts.id, schema.commercialPaymentRoutes.productId))
            .innerJoin(schema.commercialPaymentProviders, eq(schema.commercialPaymentProviders.code, schema.commercialPaymentRoutes.providerCode))
            .where(eq(schema.locations.id, configuredLocationId!)).limit(1);
          assert.ok(acceptance, "the isolated acceptance Location and Route must exist");
          assert.equal(acceptance.locationId, configuredLocationId);
          assert.equal(acceptance.routeId, configuredRouteId);
          assert.equal(acceptance.marketCode, "RU");
          assert.equal(acceptance.routeMarket, "RU");
          assert.equal(acceptance.providerCode, paymentHelpers.FAKE_PROVIDER_CODE);
          assert.equal(acceptance.productCode, "soundspa", "the acceptance Route must target SoundSpa Basic");
          assert.equal(acceptance.productActive, true);
          assert.equal(acceptance.routeEnabled, true);
          assert.equal(acceptance.providerEnabled, true);
          assert.equal(acceptance.locationArchivedAt, null);
          assert.equal(acceptance.organizationArchivedAt, null);
          assert.equal(acceptance.organizationName, "Fake Provider Acceptance");
          assert.equal((await tx.select({ id: schema.locationCoreTrials.id }).from(schema.locationCoreTrials).where(eq(schema.locationCoreTrials.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have existing Trials");
          assert.equal((await tx.select({ id: schema.commercialPartnerBenefits.id }).from(schema.commercialPartnerBenefits).where(eq(schema.commercialPartnerBenefits.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have existing Partner Benefits");
          assert.equal((await tx.select({ id: schema.locationSubscriptions.id }).from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have existing Subscriptions");
          assert.equal((await tx.select({ id: schema.devices.id }).from(schema.devices).where(eq(schema.devices.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have Devices");
          assert.equal((await tx.select({ locationId: schema.locationServiceAccess.locationId }).from(schema.locationServiceAccess).where(eq(schema.locationServiceAccess.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have legacy access rows");
          assert.equal((await tx.select({ locationId: schema.locationChannelEntitlements.locationId }).from(schema.locationChannelEntitlements).where(eq(schema.locationChannelEntitlements.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have custom channel entitlements");
          assert.equal((await tx.select({ id: schema.locationChannelGrants.id }).from(schema.locationChannelGrants).where(eq(schema.locationChannelGrants.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have admin channel grants");
          assert.equal((await tx.select({ organizationId: schema.organizationMembers.organizationId }).from(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, acceptance.organizationId))).length, 0, "the isolated acceptance Organization must not have real customer members");
          assert.equal((await tx.select({ id: schema.commercialPayments.id }).from(schema.commercialPayments).where(eq(schema.commercialPayments.locationId, configuredLocationId!))).length, 0, "the isolated acceptance Location must not have existing Payments");
          const [testOwner] = await tx.insert(schema.users).values({ email: `fake-provider-acceptance-${suffix}@example.test`, emailVerifiedAt }).returning();
          acceptanceEmail = testOwner.email;
          await tx.insert(schema.organizationMembers).values({ organizationId: acceptance.organizationId, userId: testOwner.id, role: "owner" });
          const basicChannels = await tx.select({ channelId: schema.commercialProductChannels.channelId }).from(schema.commercialProductChannels).where(eq(schema.commercialProductChannels.productId, acceptance.routeProduct));
          assert.ok(basicChannels.length > 0, "SoundSpa Basic must have its canonical Product channels");
          const basicCheckout = await fakeProvider.createFakeProviderCheckout({
            authenticatedUserId: testOwner.id,
            locationId: configuredLocationId!,
            productId: acceptance.routeProduct,
            routeId: configuredRouteId!,
          }, now, tx);
          const basicResult = await fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: testOwner.id, confirmationToken: basicCheckout.confirmationToken }, new Date(now.getTime() + 1000), tx);
          assert.equal(basicResult.accessApplied, true, "the configured SoundSpa Basic staging Route must settle successfully");
          const basicAccess = await access.resolveEffectiveChannelAccess(configuredLocationId!, new Date(now.getTime() + 1000), tx);
          for (const { channelId } of basicChannels) {
            assert.equal(basicAccess.find((entry) => entry.id === channelId)?.playable, true, "the Basic Subscription must grant its canonical Product channel");
          }
        }
        const [organization] = await tx.insert(schema.organizations).values({ name: `fake-provider-test-${suffix}` }).returning();
        organizationId = organization.id;
        const [outsideOrganization] = await tx.insert(schema.organizations).values({ name: `fake-provider-outside-${suffix}` }).returning();
        const [owner] = await tx.insert(schema.users).values({ email: `fake-owner-${suffix}@example.test`, emailVerifiedAt }).returning();
        const [manager] = await tx.insert(schema.users).values({ email: `fake-manager-${suffix}@example.test`, emailVerifiedAt }).returning();
        const [foreignUser] = await tx.insert(schema.users).values({ email: `fake-foreign-${suffix}@example.test`, emailVerifiedAt }).returning();
        const [ownerLocation] = await tx.insert(schema.locations).values({ organizationId: organization.id, name: "Fake RU", slug: `fake-ru-${suffix}`, timezone: "Europe/Moscow", marketCode: "RU" }).returning();
        const [noMarketLocation] = await tx.insert(schema.locations).values({ organizationId: organization.id, name: "Fake no market", slug: `fake-no-market-${suffix}`, timezone: "Europe/Moscow", marketCode: null }).returning();
        const [wrongMarketLocation] = await tx.insert(schema.locations).values({ organizationId: organization.id, name: "Fake other market", slug: `fake-other-market-${suffix}`, timezone: "Europe/Moscow", marketCode: "TH" }).returning();
        const [foreignLocation] = await tx.insert(schema.locations).values({ organizationId: outsideOrganization.id, name: "Fake foreign", slug: `fake-foreign-${suffix}`, timezone: "Europe/Moscow", marketCode: "RU" }).returning();
        await tx.insert(schema.organizationMembers).values([
          { organizationId: organization.id, userId: owner.id, role: "owner" },
          { organizationId: organization.id, userId: manager.id, role: "manager" },
          { organizationId: outsideOrganization.id, userId: foreignUser.id, role: "owner" },
        ]);
        const [product] = await tx.insert(schema.commercialProducts).values({ code: `fake-product-${suffix}`, name: "Fake Product", kind: "core", isActive: true }).returning();
        const [expiredProduct] = await tx.insert(schema.commercialProducts).values({ code: `fake-expired-${suffix}`, name: "Fake Expiry Product", kind: "core", isActive: true }).returning();
        const channels = await tx.select().from(schema.channels).limit(2);
        const [channel, partnerChannel] = channels;
        assert.ok(channel && partnerChannel, "two canonical channels are required for independent-benefit checks");
        await tx.insert(schema.commercialProductChannels).values([
          { productId: product.id, channelId: channel.id },
          { productId: expiredProduct.id, channelId: channel.id },
          { productId: expiredProduct.id, channelId: partnerChannel.id },
        ]);
        const [partner] = await tx.insert(schema.commercialPartners).values({ code: `fake-provider-test-${suffix}`, name: "Fake Provider Test Partner" }).returning();
        await tx.insert(schema.commercialPartnerBenefits).values({ partnerId: partner.id, productId: expiredProduct.id, locationId: ownerLocation.id, startsAt: new Date(now.getTime() - 60_000), endsAt: null });
        await tx.insert(schema.commercialPaymentProviders).values({ code: paymentHelpers.FAKE_PROVIDER_CODE, displayName: "Staging Fake Payment", isEnabled: true }).onConflictDoNothing();
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: true }).where(eq(schema.commercialPaymentProviders.code, paymentHelpers.FAKE_PROVIDER_CODE));
        const [route] = await tx.insert(schema.commercialPaymentRoutes).values({ marketCode: "RU", productId: product.id, providerCode: paymentHelpers.FAKE_PROVIDER_CODE, externalReference: `fake-plan-${suffix}`, isEnabled: true }).returning();
        const [disabledRoute] = await tx.insert(schema.commercialPaymentRoutes).values({ marketCode: "RU", productId: product.id, providerCode: paymentHelpers.FAKE_PROVIDER_CODE, externalReference: `fake-disabled-${suffix}`, isEnabled: false }).returning();
        const [wrongMarketRoute] = await tx.insert(schema.commercialPaymentRoutes).values({ marketCode: "TH", productId: product.id, providerCode: paymentHelpers.FAKE_PROVIDER_CODE, externalReference: `fake-th-${suffix}`, isEnabled: true }).returning();
        const [expiryRoute] = await tx.insert(schema.commercialPaymentRoutes).values({ marketCode: "RU", productId: expiredProduct.id, providerCode: paymentHelpers.FAKE_PROVIDER_CODE, externalReference: `fake-expiry-${suffix}`, isEnabled: true }).returning();

        const assertFakeError = async (operation: Promise<unknown>, code: string) => {
          await assert.rejects(operation, (error: unknown) => error instanceof fakeProvider.FakeProviderError && error.code === code);
        };
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: randomUUID(), locationId: ownerLocation.id, productId: product.id, routeId: route.id }, now, tx), "not_authorized");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: manager.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id }, now, tx), "not_authorized");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: foreignUser.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id }, now, tx), "not_authorized");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: foreignLocation.id, productId: product.id, routeId: route.id }, now, tx), "not_authorized");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: noMarketLocation.id, productId: product.id, routeId: route.id }, now, tx), "market_not_configured");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: wrongMarketLocation.id, productId: product.id, routeId: route.id }, now, tx), "route_unavailable");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: ownerLocation.id, productId: product.id, routeId: disabledRoute.id }, now, tx), "route_unavailable");
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: ownerLocation.id, productId: product.id, routeId: wrongMarketRoute.id }, now, tx), "route_unavailable");
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: false }).where(eq(schema.commercialPaymentProviders.code, paymentHelpers.FAKE_PROVIDER_CODE));
        await assertFakeError(fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id }, now, tx), "route_unavailable");
        await tx.update(schema.commercialPaymentProviders).set({ isEnabled: true }).where(eq(schema.commercialPaymentProviders.code, paymentHelpers.FAKE_PROVIDER_CODE));

        const expired = await fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: ownerLocation.id, productId: expiredProduct.id, routeId: expiryRoute.id }, now, tx);
        const expiredTokenBody = { confirmationToken: expired.confirmationToken, status: "succeeded" };
        assert.equal(paymentHelpers.fakeConfirmationRequestSchema.safeParse(expiredTokenBody).success, false, "client-supplied payment status must be rejected");
        await assertFakeError(fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: owner.id, confirmationToken: expired.confirmationToken }, new Date(new Date(expired.expiresAt).getTime() + 1), tx), "checkout_expired");

        const checkout = await fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id }, now, tx);
        const [pending] = await tx.select().from(schema.commercialPayments).where(eq(schema.commercialPayments.id, checkout.checkoutId));
        assert.equal(pending.status, "pending");
        assert.equal(pending.amountMinor, BigInt(108_000));
        assert.equal(pending.currency, "RUB");
        assert.equal(pending.locationId, ownerLocation.id);
        assert.equal(pending.productId, product.id);
        assert.equal(pending.routeId, route.id);

        const confirmationAt = new Date(now.getTime() + 1000);
        const settled = await fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: owner.id, confirmationToken: checkout.confirmationToken }, confirmationAt, tx);
        assert.equal(settled.accessApplied, true);
        const [subscription] = await tx.select().from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.id, settled.subscriptionId!));
        const firstPaidThrough = paymentHelpers.addOneCalendarMonth(confirmationAt);
        assert.equal(subscription.currentPeriodEndsAt?.getTime(), firstPaidThrough.getTime());
        const playable = await access.resolveEffectiveChannelAccess(ownerLocation.id, confirmationAt, tx);
        assert.equal(playable.find((entry) => entry.id === channel.id)?.playable, true);
        assert.equal(playable.find((entry) => entry.id === partnerChannel.id)?.playable, true);
        assert.deepEqual(playable.find((entry) => entry.id === partnerChannel.id)?.accessSources, ["partner_benefit"], "Partner Benefit must remain independent of the Fake Subscription");

        const duplicate = await fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: owner.id, confirmationToken: checkout.confirmationToken }, new Date(confirmationAt.getTime() + 1), tx);
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.subscriptionId, subscription.id);

        const renewalAt = new Date(confirmationAt.getTime() + 60_000);
        const renewalCheckout = await fakeProvider.createFakeProviderCheckout({ authenticatedUserId: owner.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id }, renewalAt, tx);
        const renewed = await fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: owner.id, confirmationToken: renewalCheckout.confirmationToken }, new Date(renewalAt.getTime() + 1000), tx);
        assert.equal(renewed.subscriptionId, subscription.id);
        const [renewedSubscription] = await tx.select().from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.id, subscription.id));
        const paidThrough = renewedSubscription.currentPeriodEndsAt;
        assert.equal(paidThrough?.getTime(), paymentHelpers.addOneCalendarMonth(firstPaidThrough).getTime(), "renewal confirms one calendar month after the existing period end");

        await assertFakeError(fakeProvider.createFakeProviderCheckout({
          authenticatedUserId: manager.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id,
        }, new Date(renewalAt.getTime() + 90_000), tx), "not_authorized");
        const grant = await billingPermissions.grantLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: ownerLocation.id, managerUserId: manager.id,
        }, tx);
        assert.equal(grant.granted, true);
        const managerCheckoutAt = new Date(renewalAt.getTime() + 120_000);
        const managerCheckout = await fakeProvider.createFakeProviderCheckout({
          authenticatedUserId: manager.id, locationId: ownerLocation.id, productId: product.id, routeId: route.id,
        }, managerCheckoutAt, tx);
        const managerSettlement = await fakeProvider.confirmFakeProviderCheckout({
          authenticatedUserId: manager.id, confirmationToken: managerCheckout.confirmationToken,
        }, new Date(managerCheckoutAt.getTime() + 1000), tx);
        assert.equal(managerSettlement.accessApplied, true, "explicitly authorized manager can use single-Location billing flow");

        const cancellationAt = new Date(managerCheckoutAt.getTime() + 120_000);
        const canceled = await fakeProvider.cancelFakeProviderSubscription({ authenticatedUserId: manager.id, subscriptionId: subscription.id }, cancellationAt, tx);
        assert.equal(canceled.changed, true);
        const canceledAccess = await access.resolveEffectiveChannelAccess(ownerLocation.id, cancellationAt, tx);
        assert.equal(canceledAccess.find((entry) => entry.id === channel.id)?.playable, true, "cancellation preserves confirmed paid-through access");
        assert.deepEqual(canceledAccess.find((entry) => entry.id === partnerChannel.id)?.accessSources, ["partner_benefit"]);
        const repeatedCancellation = await fakeProvider.cancelFakeProviderSubscription({ authenticatedUserId: owner.id, subscriptionId: subscription.id }, new Date(cancellationAt.getTime() + 60_000), tx);
        assert.equal(repeatedCancellation.duplicate, true);
        await billingPermissions.revokeLocationBillingPermission({
          authenticatedUserId: owner.id, locationId: ownerLocation.id, managerUserId: manager.id,
        }, tx);
        await assertFakeError(fakeProvider.cancelFakeProviderSubscription({
          authenticatedUserId: manager.id, subscriptionId: subscription.id,
        }, new Date(cancellationAt.getTime() + 120_000), tx), "not_authorized");

        await assertFakeError(fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: foreignUser.id, confirmationToken: checkout.confirmationToken }, confirmationAt, tx), "checkout_unavailable");
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    assert.equal((await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId!))).length, 0, "all generated fixture organizations must roll back");
    if (target === "staging-v2") {
      assert.equal((await v2Db.select().from(schema.commercialPayments).where(eq(schema.commercialPayments.locationId, process.env.V2_FAKE_PROVIDER_TEST_LOCATION_ID!))).length, 0, "test Payments must roll back for the isolated Location");
      assert.equal((await v2Db.select().from(schema.locationSubscriptions).where(eq(schema.locationSubscriptions.locationId, process.env.V2_FAKE_PROVIDER_TEST_LOCATION_ID!))).length, 0, "test Subscriptions must roll back for the isolated Location");
      assert.equal((await v2Db.select().from(schema.users).where(eq(schema.users.email, acceptanceEmail!))).length, 0, "temporary test customer must roll back");
    }
    console.info("Fake Provider DB integration PASS: authorization, market/route guards, pending expiry, signed customer binding, strict confirmation input, settlement, duplicate confirmation, renewal, cancellation, paid-through access and rollback.");
    } finally {
    await closePool?.();
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
