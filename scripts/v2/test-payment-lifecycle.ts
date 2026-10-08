import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { cancelTrustedSubscription, settleTrustedProviderPayment } from "../../db/v2/services/paymentLifecycle";
import {
  commercialPartnerBenefits,
  commercialPartners,
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialPayments,
  commercialProducts,
  commercialProductChannels,
  locationCoreTrials,
  locationSubscriptions,
  locations,
  organizations,
  channels,
} from "../../db/v2/schema";

class Rollback extends Error {}
const addDays = (at: Date, days: number) => new Date(at.getTime() + days * 86_400_000);

function channelState(access: Awaited<ReturnType<typeof resolveEffectiveChannelAccess>>, channelId: string) {
  const state = access.find((item) => item.id === channelId);
  assert.ok(state, `resolver should include catalog channel ${channelId}`);
  return state;
}

async function runRollbackTest() {
  let organizationId = "";
  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const providerCode = `lifecycle-${suffix}`;
      const now = new Date("2026-10-08T10:00:00.000Z");
      const [organization] = await tx.insert(organizations).values({ name: `payment-lifecycle-${suffix}` }).returning();
      organizationId = organization.id;
      const [locationA, locationB] = await tx.insert(locations).values([
        { organizationId, name: "Lifecycle A", slug: `lifecycle-a-${suffix}`, timezone: "Asia/Ho_Chi_Minh", marketCode: "VN" },
        { organizationId, name: "Lifecycle B", slug: `lifecycle-b-${suffix}`, timezone: "Asia/Bangkok", marketCode: "VN" },
      ]).returning();
      const [productA] = await tx.insert(commercialProducts).values({ code: `lifecycle-basic-${suffix}`, name: "Lifecycle Product A", kind: "core" }).returning();
      const [productPartner] = await tx.insert(commercialProducts).values({ code: `lifecycle-partner-${suffix}`, name: "Lifecycle Partner Product", kind: "partner" }).returning();
      const [channelA, channelB] = await tx.select().from(channels).limit(2);
      assert.ok(channelA && channelB, "at least two canonical channels are required for access checks");
      await tx.insert(commercialProductChannels).values([
        { productId: productA.id, channelId: channelA.id },
        { productId: productPartner.id, channelId: channelB.id },
      ]);
      await tx.insert(commercialPaymentProviders).values({ code: providerCode, displayName: "Lifecycle Test Provider", isEnabled: true });
      const [route] = await tx.insert(commercialPaymentRoutes).values({
        marketCode: "VN", productId: productA.id, providerCode, externalReference: "plan-vn-basic",
      }).returning();
      const [partner] = await tx.insert(commercialPartners).values({ code: `lifecycle-partner-${suffix}`, name: "Lifecycle Partner" }).returning();
      await tx.insert(commercialPartnerBenefits).values({ partnerId: partner.id, productId: productPartner.id, locationId: locationA.id, startsAt: addDays(now, -10), endsAt: null });
      await tx.insert(locationCoreTrials).values({ locationId: locationA.id, productId: productA.id, status: "expired", startsAt: addDays(now, -40), endsAt: addDays(now, -10) });

      const first = {
        providerCode, paymentKey: "charge-1", idempotencyKey: "event-1", externalEventId: "provider-event-1", externalPaymentId: "provider-payment-1",
        locationId: locationA.id, productId: productA.id, subscriptionId: null, routeId: route.id, routeExternalReference: "plan-vn-basic",
        externalSubscriptionRef: "external-sub-a", providerCustomerRef: "customer-a", status: "succeeded" as const,
        amountMinor: BigInt(125_000), currency: "VND", occurredAt: now, paidThroughAt: addDays(now, 45),
      };
      const before = new Map((await resolveEffectiveChannelAccess(locationA.id, now, tx)).map((item) => [item.id, item]));
      assert.equal(channelState([...before.values()], channelA.id).playable, false, "expired Trial must not make the Product channel playable");
      assert.deepEqual(channelState([...before.values()], channelA.id).accessSources, []);
      const settled = await settleTrustedProviderPayment(first, tx);
      assert.equal(settled.reason, "settled");
      assert.equal(settled.accessApplied, true);
      assert.ok(settled.subscriptionId);
      const afterFirst = new Map((await resolveEffectiveChannelAccess(locationA.id, now, tx)).map((item) => [item.id, item]));
      assert.equal(channelState([...afterFirst.values()], channelA.id).playable, true);
      assert.deepEqual(afterFirst.get(channelA.id)?.accessSources, ["subscription"]);
      assert.equal(channelState([...afterFirst.values()], channelB.id).playable, true);
      assert.deepEqual(afterFirst.get(channelB.id)?.accessSources, ["partner_benefit"]);
      const [subscriptionAfterFirst] = await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.id, settled.subscriptionId as string));
      assert.equal(subscriptionAfterFirst.currentPeriodEndsAt?.getTime(), addDays(now, 45).getTime());

      const duplicate = await settleTrustedProviderPayment(first, tx);
      assert.equal(duplicate.duplicate, true);
      const duplicatePaymentIdentity = await settleTrustedProviderPayment({
        ...first, idempotencyKey: "event-1-replay", externalEventId: "provider-event-1-replay", occurredAt: addDays(now, 1),
      }, tx);
      assert.equal(duplicatePaymentIdentity.reason, "duplicate_success");
      const [stillFirstPeriod] = await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.id, settled.subscriptionId as string));
      assert.equal(stillFirstPeriod.currentPeriodEndsAt?.getTime(), addDays(now, 45).getTime(), "replayed successful payment must not renew twice");
      await assert.rejects(settleTrustedProviderPayment({
        ...first, idempotencyKey: "event-conflicting-ref", externalEventId: "provider-event-conflicting-ref", externalSubscriptionRef: "other-sub",
      }, tx), (error: unknown) => error instanceof Error && error.message === "payment_identity_conflict");
      await assert.rejects(settleTrustedProviderPayment({
        ...first, paymentKey: "different-key", idempotencyKey: "event-conflicting-payment", externalEventId: "provider-event-conflicting-payment",
      }, tx), (error: unknown) => error instanceof Error && error.message === "payment_identity_conflict");

      const renewal = await settleTrustedProviderPayment({
        ...first, paymentKey: "charge-2", idempotencyKey: "event-2", externalEventId: "provider-event-2", externalPaymentId: "provider-payment-2",
        occurredAt: addDays(now, 30), paidThroughAt: addDays(now, 75),
      }, tx);
      assert.equal(renewal.reason, "settled");
      assert.equal(renewal.subscriptionId, settled.subscriptionId);
      const older = await settleTrustedProviderPayment({
        ...first, paymentKey: "charge-out-of-order", idempotencyKey: "event-old", externalEventId: "provider-event-old", externalPaymentId: "provider-payment-old",
        occurredAt: addDays(now, 20), paidThroughAt: addDays(now, 40),
      }, tx);
      assert.equal(older.reason, "settled");
      const [afterOlderPayment] = await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.id, settled.subscriptionId as string));
      assert.equal(afterOlderPayment.currentPeriodEndsAt?.getTime(), addDays(now, 75).getTime(), "out-of-order payment must not shorten the period");

      const outOfOrderCancellation = await cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-event-before-latest-payment", externalEventId: "provider-cancel-before-latest-payment",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productA.id,
        occurredAt: addDays(now, 20), paidThroughAt: addDays(now, 25),
      }, tx);
      assert.equal(outOfOrderCancellation.stale, true, "cancellation older than a confirmed payment must be recorded but not applied");
      const [afterOutOfOrderCancellation] = await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.id, settled.subscriptionId as string));
      assert.equal(afterOutOfOrderCancellation.currentPeriodEndsAt?.getTime(), addDays(now, 75).getTime());
      assert.equal(afterOutOfOrderCancellation.canceledAt, null);

      await assert.rejects(cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-wrong-location", externalEventId: "provider-cancel-wrong-location",
        externalSubscriptionRef: "external-sub-a", locationId: locationB.id, productId: productA.id,
        occurredAt: addDays(now, 55), paidThroughAt: addDays(now, 80),
      }, tx), (error: unknown) => error instanceof Error && error.message === "subscription_not_found");
      await assert.rejects(cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-wrong-product", externalEventId: "provider-cancel-wrong-product",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productPartner.id,
        occurredAt: addDays(now, 55), paidThroughAt: addDays(now, 80),
      }, tx), (error: unknown) => error instanceof Error && error.message === "subscription_not_found");
      await assert.rejects(cancelTrustedSubscription({
        providerCode: `other-${providerCode}`, idempotencyKey: "cancel-wrong-provider", externalEventId: "provider-cancel-wrong-provider",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productA.id,
        occurredAt: addDays(now, 55), paidThroughAt: addDays(now, 80),
      }, tx), (error: unknown) => error instanceof Error && error.message === "subscription_not_found");
      const paymentCountBeforeCancellation = (await tx.select().from(commercialPayments).where(eq(commercialPayments.locationId, locationA.id))).length;
      const cancellation = await cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-event-1", externalEventId: "provider-cancel-1",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productA.id,
        occurredAt: addDays(now, 60), paidThroughAt: addDays(now, 80),
      }, tx);
      assert.equal(cancellation.changed, true);
      assert.equal((await tx.select().from(commercialPayments).where(eq(commercialPayments.locationId, locationA.id))).length, paymentCountBeforeCancellation, "cancellation must not create a Payment");
      const replayedCancellation = await cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-event-1", externalEventId: "provider-cancel-1",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productA.id,
        occurredAt: addDays(now, 60), paidThroughAt: addDays(now, 80),
      }, tx);
      assert.equal(replayedCancellation.duplicate, true);
      await assert.rejects(cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-event-1", externalEventId: "provider-cancel-1",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productA.id,
        occurredAt: addDays(now, 60), paidThroughAt: addDays(now, 90),
      }, tx), (error: unknown) => error instanceof Error && error.message === "payment_event_identity_conflict");
      await assert.rejects(cancelTrustedSubscription({
        providerCode, idempotencyKey: "cancel-reuses-payment-event", externalEventId: "provider-event-1",
        externalSubscriptionRef: "external-sub-a", locationId: locationA.id, productId: productA.id,
        occurredAt: addDays(now, 60), paidThroughAt: addDays(now, 80),
      }, tx), (error: unknown) => error instanceof Error && error.message === "payment_event_identity_conflict");
      const duringPaidPeriod = new Map((await resolveEffectiveChannelAccess(locationA.id, addDays(now, 79), tx)).map((item) => [item.id, item]));
      const afterPaidPeriod = new Map((await resolveEffectiveChannelAccess(locationA.id, addDays(now, 81), tx)).map((item) => [item.id, item]));
      assert.equal(channelState([...duringPaidPeriod.values()], channelA.id).playable, true);
      assert.deepEqual(duringPaidPeriod.get(channelA.id)?.accessSources, ["subscription"]);
      assert.equal(channelState([...afterPaidPeriod.values()], channelA.id).playable, false, "expired paid period must leave the Product channel locked");
      assert.deepEqual(afterPaidPeriod.get(channelA.id)?.accessSources, []);
      assert.equal(channelState([...afterPaidPeriod.values()], channelB.id).playable, true);
      assert.deepEqual(afterPaidPeriod.get(channelB.id)?.accessSources, ["partner_benefit"], "expired subscription must not remove independent Partner Benefit");
      const stalePayment = await settleTrustedProviderPayment({
        ...first, paymentKey: "charge-stale", idempotencyKey: "event-stale", externalEventId: "provider-event-stale", externalPaymentId: "provider-payment-stale",
        occurredAt: addDays(now, 50), paidThroughAt: addDays(now, 90),
      }, tx);
      assert.equal(stalePayment.reason, "stale_canceled_subscription", "an out-of-order pre-cancellation payment cannot reactivate access");
      const [afterStalePayment] = await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.id, settled.subscriptionId as string));
      assert.equal(afterStalePayment.currentPeriodEndsAt?.getTime(), addDays(now, 80).getTime(), "stale success must not extend the canceled paid period");
      const restored = await settleTrustedProviderPayment({
        ...first, paymentKey: "charge-restored", idempotencyKey: "event-restored", externalEventId: "provider-event-restored", externalPaymentId: "provider-payment-restored",
        occurredAt: addDays(now, 80), paidThroughAt: addDays(now, 110),
      }, tx);
      assert.equal(restored.reason, "settled", "a later successful recurring payment can restore access");
      assert.deepEqual(new Map((await resolveEffectiveChannelAccess(locationA.id, addDays(now, 81), tx)).map((item) => [item.id, item])).get(channelA.id)?.accessSources, ["subscription"]);

      const failed = await settleTrustedProviderPayment({
        ...first, paymentKey: "charge-failed", idempotencyKey: "event-failed", externalEventId: "provider-event-failed", externalPaymentId: "provider-payment-failed",
        locationId: locationB.id, externalSubscriptionRef: "external-sub-b", providerCustomerRef: "customer-b", status: "failed", occurredAt: now, paidThroughAt: null,
      }, tx);
      assert.equal(failed.accessApplied, false);
      assert.equal(failed.subscriptionId, null);
      assert.equal((await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.locationId, locationB.id))).length, 0);
      assert.equal((await tx.select().from(commercialPayments).where(and(eq(commercialPayments.locationId, locationB.id), eq(commercialPayments.status, "failed")))).length, 1);
      const noEntitlements = await resolveEffectiveChannelAccess(locationB.id, now, tx);
      assert.equal(noEntitlements.some((item) => item.playable), false, "failed payment must leave a no-entitlement Location without playable channels");

      const paidOtherLocation = await settleTrustedProviderPayment({
        ...first, paymentKey: "charge-location-b", idempotencyKey: "event-location-b", externalEventId: "provider-event-location-b", externalPaymentId: "provider-payment-location-b",
        locationId: locationB.id, externalSubscriptionRef: "external-sub-location-b", providerCustomerRef: "customer-b", occurredAt: now, paidThroughAt: addDays(now, 20),
      }, tx);
      assert.notEqual(paidOtherLocation.subscriptionId, settled.subscriptionId, "each Location must have its own Subscription");
      const locationBAccess = await resolveEffectiveChannelAccess(locationB.id, now, tx);
      assert.equal(channelState(locationBAccess, channelA.id).playable, true);
      assert.deepEqual(channelState(locationBAccess, channelA.id).accessSources, ["subscription"]);
      assert.equal(channelState(locationBAccess, channelB.id).playable, false, "Partner Benefit for Location A must not leak to Location B");
      throw new Rollback();
    });
  } catch (error) { if (!(error instanceof Rollback)) throw error; }
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  console.info("Payment lifecycle integration PASS: first settlement, expired-Trial recovery, recurring renewal, webhook/payment idempotency, conflicting identities, failed payment, out-of-order periods, cancellation paid-through, independent Partner Benefit, per-Location subscriptions, and rollback.");
}

async function main() {
  try {
    await runRollbackTest();
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
