import { and, desc, eq, isNull, or } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialPayments,
  commercialProducts,
  locationSubscriptions,
  locations,
} from "../schema";
import { PaymentFoundationError, recordNormalizedPayment } from "./paymentFoundation";
import type { NormalizedPaymentInput } from "./paymentFoundationModel";
import { paymentCanRestoreCanceledSubscription, preserveLatestPaidThrough, validateProviderPaidThrough } from "./paymentLifecycleModel";

type LifecycleDb = Pick<typeof v2Db, "select" | "insert" | "update" | "transaction">;

/**
 * This input is accepted only from a server-side provider adapter after that
 * adapter has authenticated the provider notification. It is not an HTTP API.
 */
export type TrustedProviderPaymentEvent = NormalizedPaymentInput & {
  routeExternalReference: string;
  providerCustomerRef?: string | null;
  /** Provider-confirmed end of the paid period; never inferred from amount. */
  paidThroughAt?: Date | null;
};

export type PaymentSettlementResult = {
  duplicate: boolean;
  paymentId: string;
  subscriptionId: string | null;
  accessApplied: boolean;
  reason: "non_success_payment" | "duplicate_event" | "duplicate_success" | "stale_canceled_subscription" | "settled";
};

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

/**
 * Atomically records a normalized provider event and applies a confirmed paid
 * period to the matching Location/Product Subscription. Provider signature
 * verification must happen before calling this trusted internal service.
 */
export async function settleTrustedProviderPayment(event: TrustedProviderPaymentEvent, db: LifecycleDb = v2Db): Promise<PaymentSettlementResult> {
  if (!event.routeId || !event.routeExternalReference?.trim()) throw new PaymentFoundationError("payment_route_mismatch");
  const routeId = event.routeId;
  if (event.status === "succeeded") {
    if (!event.externalSubscriptionRef?.trim()) throw new PaymentFoundationError("provider_reference_conflict");
    validateProviderPaidThrough(event.occurredAt as Date, event.paidThroughAt ?? null);
  }
  if (event.providerCustomerRef !== undefined && event.providerCustomerRef !== null && !event.providerCustomerRef.trim()) {
    throw new PaymentFoundationError("provider_reference_conflict");
  }

  return db.transaction(async (tx) => {
    const [provider] = await tx.select({ code: commercialPaymentProviders.code })
      .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, event.providerCode)).limit(1);
    if (!provider) throw new PaymentFoundationError("provider_not_found");

    const [route] = await tx.select({
      id: commercialPaymentRoutes.id,
      providerCode: commercialPaymentRoutes.providerCode,
      productId: commercialPaymentRoutes.productId,
      marketCode: commercialPaymentRoutes.marketCode,
      externalReference: commercialPaymentRoutes.externalReference,
      locationId: locations.id,
      locationMarketCode: locations.marketCode,
    }).from(commercialPaymentRoutes)
      .innerJoin(locations, eq(locations.id, event.locationId))
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialPaymentRoutes.productId))
      .where(and(
        eq(commercialPaymentRoutes.id, routeId),
        eq(locations.id, event.locationId),
        eq(commercialPaymentRoutes.productId, event.productId),
        isNull(locations.archivedAt),
      )).limit(1).for("update");
    if (!route || route.providerCode !== event.providerCode || route.externalReference !== event.routeExternalReference ||
        !route.locationMarketCode || route.marketCode !== route.locationMarketCode) {
      throw new PaymentFoundationError("payment_route_mismatch");
    }

    const [existingPayment] = await tx.select().from(commercialPayments).where(or(
      and(eq(commercialPayments.providerCode, event.providerCode), eq(commercialPayments.paymentKey, event.paymentKey)),
      ...(event.externalPaymentId ? [and(eq(commercialPayments.providerCode, event.providerCode), eq(commercialPayments.externalPaymentId, event.externalPaymentId))] : []),
    )).limit(1).for("update");
    if (existingPayment && (existingPayment.locationId !== event.locationId || existingPayment.productId !== event.productId ||
        existingPayment.routeId !== event.routeId || existingPayment.externalSubscriptionRef !== event.externalSubscriptionRef)) {
      throw new PaymentFoundationError("payment_identity_conflict");
    }

    let subscription = null as typeof locationSubscriptions.$inferSelect | null;
    if (event.externalSubscriptionRef) {
      [subscription] = await tx.select().from(locationSubscriptions).where(and(
        eq(locationSubscriptions.provider, event.providerCode),
        eq(locationSubscriptions.providerSubscriptionRef, event.externalSubscriptionRef),
      )).limit(1).for("update");
    }
    const requestedSubscriptionId = event.subscriptionId ?? existingPayment?.subscriptionId ?? null;
    if (requestedSubscriptionId && (!subscription || subscription.id !== requestedSubscriptionId)) {
      const [requested] = await tx.select().from(locationSubscriptions).where(and(
        eq(locationSubscriptions.id, requestedSubscriptionId),
        eq(locationSubscriptions.provider, event.providerCode),
        eq(locationSubscriptions.locationId, event.locationId),
        eq(locationSubscriptions.productId, event.productId),
      )).limit(1).for("update");
      if (!requested || (subscription && requested.id !== subscription.id) ||
          (requested.providerSubscriptionRef && requested.providerSubscriptionRef !== event.externalSubscriptionRef)) {
        throw new PaymentFoundationError("subscription_reference_conflict");
      }
      subscription = requested;
    }
    if (subscription && (subscription.locationId !== event.locationId || subscription.productId !== event.productId ||
        subscription.provider !== event.providerCode ||
        (subscription.providerSubscriptionRef && subscription.providerSubscriptionRef !== event.externalSubscriptionRef))) {
      throw new PaymentFoundationError("subscription_reference_conflict");
    }
    if (subscription && event.providerCustomerRef && subscription.providerCustomerRef &&
        subscription.providerCustomerRef !== event.providerCustomerRef) {
      throw new PaymentFoundationError("provider_reference_conflict");
    }

    const normalized: NormalizedPaymentInput = { ...event, subscriptionId: subscription?.id ?? null };
    const previousStatus = existingPayment?.status ?? null;
    const recorded = await recordNormalizedPayment(normalized, tx);
    if (recorded.duplicate) {
      return { duplicate: true, paymentId: recorded.paymentId, subscriptionId: subscription?.id ?? null, accessApplied: false, reason: "duplicate_event" };
    }
    if (event.status !== "succeeded") {
      return { duplicate: false, paymentId: recorded.paymentId, subscriptionId: subscription?.id ?? null, accessApplied: false, reason: "non_success_payment" };
    }

    const [payment] = await tx.select().from(commercialPayments).where(eq(commercialPayments.id, recorded.paymentId)).limit(1);
    if (!payment || payment.status !== "succeeded" || previousStatus === "succeeded" ||
        !sameInstant(payment.providerOccurredAt, event.occurredAt)) {
      return { duplicate: false, paymentId: recorded.paymentId, subscriptionId: subscription?.id ?? null, accessApplied: false, reason: "duplicate_success" };
    }

    const occurredAt = event.occurredAt as Date;
    const paidThroughAt = event.paidThroughAt as Date;
    if (subscription?.canceledAt && !paymentCanRestoreCanceledSubscription(occurredAt, subscription.canceledAt)) {
      return { duplicate: false, paymentId: recorded.paymentId, subscriptionId: subscription.id, accessApplied: false, reason: "stale_canceled_subscription" };
    }

    if (!subscription) {
      [subscription] = await tx.insert(locationSubscriptions).values({
        locationId: event.locationId,
        productId: event.productId,
        provider: event.providerCode,
        providerCustomerRef: event.providerCustomerRef ?? null,
        providerSubscriptionRef: event.externalSubscriptionRef as string,
        status: "active",
        startsAt: occurredAt,
        currentPeriodEndsAt: paidThroughAt,
      }).returning();
    } else {
      const newPeriodEnd = preserveLatestPaidThrough(subscription.currentPeriodEndsAt, paidThroughAt);
      [subscription] = await tx.update(locationSubscriptions).set({
        status: "active",
        providerCustomerRef: subscription.providerCustomerRef ?? event.providerCustomerRef ?? null,
        providerSubscriptionRef: subscription.providerSubscriptionRef ?? event.externalSubscriptionRef,
        currentPeriodEndsAt: newPeriodEnd,
        canceledAt: null,
        updatedAt: new Date(),
      }).where(eq(locationSubscriptions.id, subscription.id)).returning();
    }
    await tx.update(commercialPayments).set({ subscriptionId: subscription.id, updatedAt: new Date() })
      .where(eq(commercialPayments.id, payment.id));
    return { duplicate: false, paymentId: payment.id, subscriptionId: subscription.id, accessApplied: true, reason: "settled" };
  });
}

export type TrustedSubscriptionCancellation = {
  providerCode: string;
  externalSubscriptionRef: string;
  locationId: string;
  productId: string;
  occurredAt: Date;
  /** Optional period end supplied by the authenticated provider cancellation event. */
  paidThroughAt?: Date | null;
};

/** Applies an authenticated cancellation without removing still-paid access. */
export async function cancelTrustedSubscription(event: TrustedSubscriptionCancellation, db: LifecycleDb = v2Db) {
  if (!event.externalSubscriptionRef.trim() || !Number.isFinite(event.occurredAt.getTime())) throw new PaymentFoundationError("provider_reference_conflict");
  return db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(locationSubscriptions).where(and(
      eq(locationSubscriptions.provider, event.providerCode),
      eq(locationSubscriptions.providerSubscriptionRef, event.externalSubscriptionRef),
      eq(locationSubscriptions.locationId, event.locationId),
      eq(locationSubscriptions.productId, event.productId),
    )).limit(1).for("update");
    if (!subscription) throw new PaymentFoundationError("subscription_not_found");
    const [latestPayment] = await tx.select({ occurredAt: commercialPayments.providerOccurredAt }).from(commercialPayments)
      .where(and(eq(commercialPayments.subscriptionId, subscription.id), eq(commercialPayments.status, "succeeded")))
      .orderBy(desc(commercialPayments.providerOccurredAt)).limit(1);
    if ((subscription.canceledAt && event.occurredAt.getTime() <= subscription.canceledAt.getTime()) ||
        (latestPayment?.occurredAt && event.occurredAt.getTime() < latestPayment.occurredAt.getTime())) {
      return { changed: false as const, subscriptionId: subscription.id, stale: true as const };
    }
    if (!event.paidThroughAt && subscription.currentPeriodEndsAt === null) {
      throw new PaymentFoundationError("provider_paid_through_required");
    }
    const periodEnd = event.paidThroughAt
      ? subscription.currentPeriodEndsAt === null
        ? event.paidThroughAt
        : preserveLatestPaidThrough(subscription.currentPeriodEndsAt, event.paidThroughAt)
      : subscription.currentPeriodEndsAt;
    if (event.paidThroughAt && event.paidThroughAt.getTime() <= subscription.startsAt.getTime()) {
      throw new PaymentFoundationError("provider_paid_through_required");
    }
    const [updated] = await tx.update(locationSubscriptions).set({
      status: "canceled",
      canceledAt: event.occurredAt,
      currentPeriodEndsAt: periodEnd,
      updatedAt: new Date(),
    }).where(eq(locationSubscriptions.id, subscription.id)).returning({ id: locationSubscriptions.id });
    return { changed: Boolean(updated), subscriptionId: subscription.id, stale: false as const };
  });
}
