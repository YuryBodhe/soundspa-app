import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

class Rollback extends Error {}

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) throw new Error("V2_DATABASE_URL is required for the local rollback-only Fake Provider test.");
  const hostname = new URL(databaseUrl).hostname;
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
    throw new Error("Refusing DB-backed Fake Provider test unless V2_DATABASE_URL targets a loopback host.");
  }

  const oldEnv = new Map(["V2_DEPLOYMENT_ENV", "V2_FAKE_PROVIDER_ENABLED", "V2_FAKE_PROVIDER_SECRET", "V2_PUBLIC_ORIGIN"].map((key) => [key, process.env[key]]));
  process.env.V2_DEPLOYMENT_ENV = "staging";
  process.env.V2_FAKE_PROVIDER_ENABLED = "1";
  process.env.V2_FAKE_PROVIDER_SECRET = "rollback-only-test-secret-that-is-at-least-32-bytes";
  process.env.V2_PUBLIC_ORIGIN = "https://test.soundspa.bodhemusic.com";

  const [{ v2Db, v2Pool }, schema, fakeProvider, paymentHelpers, access] = await Promise.all([
    import("../../db/v2/client"),
    import("../../db/v2/schema"),
    import("../../db/v2/services/fakePaymentProvider"),
    import("../../lib/v2/fakePaymentProvider"),
    import("../../db/v2/queries/effectiveAccess"),
  ]);
  let organizationId: string | null = null;
  try {
    try {
      await v2Db.transaction(async (tx) => {
        const suffix = randomUUID();
        const now = new Date();
        const emailVerifiedAt = new Date(now.getTime() - 1000);
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
        const [channel] = await tx.select().from(schema.channels).limit(1);
        assert.ok(channel, "a canonical channel is required for effective-access checks");
        await tx.insert(schema.commercialProductChannels).values([
          { productId: product.id, channelId: channel.id },
          { productId: expiredProduct.id, channelId: channel.id },
        ]);
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

        const cancellationAt = new Date(renewalAt.getTime() + 120_000);
        const canceled = await fakeProvider.cancelFakeProviderSubscription({ authenticatedUserId: owner.id, subscriptionId: subscription.id }, cancellationAt, tx);
        assert.equal(canceled.changed, true);
        const canceledAccess = await access.resolveEffectiveChannelAccess(ownerLocation.id, cancellationAt, tx);
        assert.equal(canceledAccess.find((entry) => entry.id === channel.id)?.playable, true, "cancellation preserves confirmed paid-through access");
        const repeatedCancellation = await fakeProvider.cancelFakeProviderSubscription({ authenticatedUserId: owner.id, subscriptionId: subscription.id }, new Date(cancellationAt.getTime() + 60_000), tx);
        assert.equal(repeatedCancellation.duplicate, true);

        await assertFakeError(fakeProvider.confirmFakeProviderCheckout({ authenticatedUserId: foreignUser.id, confirmationToken: checkout.confirmationToken }, confirmationAt, tx), "checkout_unavailable");
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    assert.equal((await v2Db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId!))).length, 0, "all fixtures must roll back");
    console.info("Fake Provider DB integration PASS: authorization, market/route guards, pending expiry, signed customer binding, strict confirmation input, settlement, duplicate confirmation, renewal, cancellation, paid-through access and rollback.");
  } finally {
    await v2Pool.end();
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
