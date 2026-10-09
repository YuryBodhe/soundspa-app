import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines,
  commercialBillingOrders,
  commercialPaymentAllocations,
  commercialPaymentProviders,
  commercialPaymentEvents,
  commercialPaymentRoutes,
  commercialPayments,
  commercialProducts,
  locationCoreTrials,
  locationSubscriptions,
  locations,
} from "../schema";
import { PaymentFoundationError, recordNormalizedPayment } from "./paymentFoundation";
import type { NormalizedPaymentInput } from "./paymentFoundationModel";
import { paymentCanRestoreCanceledSubscription, preserveLatestPaidThrough, validateProviderPaidThrough } from "./paymentLifecycleModel";
import { planNextSubscriptionPeriod } from "./billingCalendar";
import { billingOrderSnapshotReference } from "./billingOrderModel";

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

export type AggregateBillingOrderSettlementInput = {
  orderId: string;
  paymentId: string;
  providerCode: string;
  paymentKey: string;
  externalPaymentId: string | null;
  idempotencyKey: string;
  externalEventId: string | null;
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
};

export type AggregateBillingOrderSettlementResult = {
  duplicate: boolean;
  paymentId: string;
  orderId: string;
  allocations: Array<{ orderLineId: string; subscriptionId: string }>;
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
        isNull(locationSubscriptions.invalidatedByResetId),
      )).limit(1).for("update");
    }
    const requestedSubscriptionId = event.subscriptionId ?? existingPayment?.subscriptionId ?? null;
    if (requestedSubscriptionId && (!subscription || subscription.id !== requestedSubscriptionId)) {
      const [requested] = await tx.select().from(locationSubscriptions).where(and(
        eq(locationSubscriptions.id, requestedSubscriptionId),
        eq(locationSubscriptions.provider, event.providerCode),
        eq(locationSubscriptions.locationId, event.locationId),
        eq(locationSubscriptions.productId, event.productId),
        isNull(locationSubscriptions.invalidatedByResetId),
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

function aggregateBillingEventCondition(event: AggregateBillingOrderSettlementInput) {
  return event.externalEventId
    ? or(
      and(eq(commercialPaymentEvents.providerCode, event.providerCode), eq(commercialPaymentEvents.idempotencyKey, event.idempotencyKey)),
      and(eq(commercialPaymentEvents.providerCode, event.providerCode), eq(commercialPaymentEvents.externalEventId, event.externalEventId)),
    )
    : and(eq(commercialPaymentEvents.providerCode, event.providerCode), eq(commercialPaymentEvents.idempotencyKey, event.idempotencyKey));
}

/**
 * Settles one trusted aggregate payment across all immutable Billing Order
 * lines. Every allocation and Subscription extension is committed atomically.
 * This internal service never accepts browser payment-status claims.
 */
export async function settleTrustedBillingOrderPayment(
  event: AggregateBillingOrderSettlementInput,
  db: LifecycleDb = v2Db,
): Promise<AggregateBillingOrderSettlementResult> {
  if (!event.orderId || !event.paymentId || !event.providerCode || !event.paymentKey.trim() ||
      !event.idempotencyKey.trim() || (event.externalEventId !== null && !event.externalEventId.trim()) ||
      typeof event.amountMinor !== "bigint" || event.amountMinor <= BigInt(0) ||
      !/^[A-Z]{3}$/.test(event.currency) || !Number.isFinite(event.occurredAt.getTime())) {
    throw new PaymentFoundationError("billing_order_invalid");
  }

  return db.transaction(async (tx) => {
    const [provider] = await tx.select({ code: commercialPaymentProviders.code })
      .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, event.providerCode)).limit(1);
    if (!provider) throw new PaymentFoundationError("provider_not_found");
    const [order] = await tx.select().from(commercialBillingOrders)
      .where(eq(commercialBillingOrders.id, event.orderId)).for("update").limit(1);
    const [payment] = await tx.select().from(commercialPayments)
      .where(eq(commercialPayments.id, event.paymentId)).for("update").limit(1);
    if (!order || !payment || payment.billingOrderId !== order.id ||
        order.providerCode !== event.providerCode || payment.providerCode !== event.providerCode ||
        order.currency !== event.currency || payment.currency !== event.currency ||
        order.totalAmountMinor !== event.amountMinor || payment.amountMinor !== event.amountMinor ||
        payment.paymentKey !== event.paymentKey || payment.externalPaymentId !== event.externalPaymentId ||
        payment.locationId !== null || payment.productId !== null || payment.subscriptionId !== null || payment.routeId !== null) {
      throw new PaymentFoundationError("payment_identity_conflict");
    }

    const lines = await tx.select().from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.locationId), asc(commercialBillingOrderLines.id)).for("update");
    if (lines.length === 0 || lines.some((line) => line.organizationId !== order.organizationId ||
        line.providerCode !== order.providerCode || line.currency !== order.currency ||
        line.durationMonths < 1 || line.durationMonths > 12 || line.amountMinor < BigInt(0) ||
        line.amountMinor !== line.listAmountMinor - line.discountAmountMinor)) {
      throw new PaymentFoundationError("billing_order_allocation_invalid");
    }
    const lineTotal = lines.reduce((total, line) => total + line.amountMinor, BigInt(0));
    if (lineTotal !== event.amountMinor || order.quoteReference !== billingOrderSnapshotReference(order, lines)) {
      throw new PaymentFoundationError("billing_order_allocation_invalid");
    }
    const persistedAllocations = await tx.select({
      orderLineId: commercialPaymentAllocations.orderLineId,
      amountMinor: commercialPaymentAllocations.amountMinor,
    }).from(commercialPaymentAllocations).where(and(
      eq(commercialPaymentAllocations.paymentId, payment.id),
      eq(commercialPaymentAllocations.orderId, order.id),
    ));
    const allocationByLine = new Map(persistedAllocations.map((allocation) => [allocation.orderLineId, allocation.amountMinor]));
    if (persistedAllocations.length !== lines.length || lines.some((line) => allocationByLine.get(line.id) !== line.amountMinor)) {
      throw new PaymentFoundationError("billing_order_allocation_invalid");
    }

    const eventCondition = aggregateBillingEventCondition(event);
    const [priorEvent] = await tx.select().from(commercialPaymentEvents).where(eventCondition).for("update").limit(1);
    if (priorEvent) {
      if (priorEvent.paymentId !== payment.id || priorEvent.paymentKey !== event.paymentKey ||
          priorEvent.idempotencyKey !== event.idempotencyKey || priorEvent.externalEventId !== event.externalEventId ||
          priorEvent.status !== "succeeded" || !sameInstant(priorEvent.occurredAt, event.occurredAt) ||
          payment.status !== "succeeded" || order.status !== "paid") {
        throw new PaymentFoundationError("payment_event_identity_conflict");
      }
      const allocations = await tx.select({ orderLineId: commercialPaymentAllocations.orderLineId, subscriptionId: commercialBillingOrderLines.subscriptionId })
        .from(commercialPaymentAllocations)
        .innerJoin(commercialBillingOrderLines, eq(commercialBillingOrderLines.id, commercialPaymentAllocations.orderLineId))
        .where(and(eq(commercialPaymentAllocations.paymentId, payment.id), eq(commercialPaymentAllocations.orderId, order.id)));
      if (allocations.length !== lines.length || allocations.some((allocation) => !allocation.subscriptionId)) {
        throw new PaymentFoundationError("billing_order_allocation_invalid");
      }
      return { duplicate: true, paymentId: payment.id, orderId: order.id,
        allocations: allocations.map((allocation) => ({ orderLineId: allocation.orderLineId, subscriptionId: allocation.subscriptionId! })) };
    }

    if (order.status !== "pending" || payment.status !== "pending") throw new PaymentFoundationError("billing_order_invalid");
    if (!order.expiresAt || event.occurredAt.getTime() >= order.expiresAt.getTime()) throw new PaymentFoundationError("billing_order_expired");
    const [insertedEvent] = await tx.insert(commercialPaymentEvents).values({
      providerCode: event.providerCode,
      paymentId: payment.id,
      externalEventId: event.externalEventId,
      paymentKey: event.paymentKey,
      idempotencyKey: event.idempotencyKey,
      status: "succeeded",
      occurredAt: event.occurredAt,
    }).onConflictDoNothing().returning({ id: commercialPaymentEvents.id });
    if (!insertedEvent) throw new PaymentFoundationError("payment_event_identity_conflict");

    const locationIds = [...new Set(lines.map((line) => line.locationId))].sort();
    const lockedLocations = await tx.select({ id: locations.id, organizationId: locations.organizationId, archivedAt: locations.archivedAt })
      .from(locations).where(inArray(locations.id, locationIds)).orderBy(asc(locations.id)).for("update");
    if (lockedLocations.length !== locationIds.length || lockedLocations.some((location) =>
      location.organizationId !== order.organizationId || location.archivedAt !== null)) {
      throw new PaymentFoundationError("billing_order_invalid");
    }

    const allocations: AggregateBillingOrderSettlementResult["allocations"] = [];
    for (const line of lines) {
      // The Location row lock above serializes distinct settlements for this
      // Location. Re-read every same-Product period after acquiring it so two
      // concurrent purchases cannot schedule overlapping time.
      const subscriptions = await tx.select().from(locationSubscriptions).where(and(
        eq(locationSubscriptions.locationId, line.locationId),
        eq(locationSubscriptions.productId, line.productId),
        isNull(locationSubscriptions.invalidatedByResetId),
        inArray(locationSubscriptions.status, ["active", "canceled"]),
      )).orderBy(desc(locationSubscriptions.currentPeriodEndsAt), desc(locationSubscriptions.startsAt), desc(locationSubscriptions.createdAt), desc(locationSubscriptions.id)).for("update");
      const [trial] = await tx.select({ status: locationCoreTrials.status, startsAt: locationCoreTrials.startsAt, endsAt: locationCoreTrials.endsAt })
        .from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, line.locationId), eq(locationCoreTrials.productId, line.productId), isNull(locationCoreTrials.invalidatedByResetId))).limit(1);
      let period;
      try {
        period = planNextSubscriptionPeriod({
          now: event.occurredAt, durationMonths: line.durationMonths,
          subscriptions: subscriptions.map((row) => ({ id: row.id, status: row.status, startsAt: row.startsAt, endsAt: row.currentPeriodEndsAt,
            billingAnchorDay: row.billingAnchorDay, billingAnchorIsEndOfMonth: row.billingAnchorIsEndOfMonth })),
          trial,
        });
      } catch {
        throw new PaymentFoundationError("billing_order_invalid");
      }
      const subscription = subscriptions.find((row) => row.id === period.subscriptionId) ?? null;

      let appliedSubscription: typeof locationSubscriptions.$inferSelect;
      if (subscription) {
        // A prepaid settlement extends time without changing the provider
        // contract or clearing an existing cancellation request.
        const remainsCanceled = subscription.status === "canceled" || subscription.canceledAt !== null;
        [appliedSubscription] = await tx.update(locationSubscriptions).set({
          status: remainsCanceled ? "canceled" : "active",
          currentPeriodEndsAt: period.endsAt,
          billingAnchorDay: subscription.billingAnchorDay ?? period.anchor.dayOfMonth,
          billingAnchorIsEndOfMonth: subscription.billingAnchorIsEndOfMonth ?? period.anchor.isEndOfMonth,
          updatedAt: event.occurredAt,
        }).where(eq(locationSubscriptions.id, subscription.id)).returning();
      } else {
        [appliedSubscription] = await tx.insert(locationSubscriptions).values({
          locationId: line.locationId,
          productId: line.productId,
          provider: event.providerCode,
          providerSubscriptionRef: null,
          status: "active",
          startsAt: period.startsAt,
          currentPeriodEndsAt: period.endsAt,
          billingAnchorDay: period.anchor.dayOfMonth,
          billingAnchorIsEndOfMonth: period.anchor.isEndOfMonth,
        }).returning();
      }
      if (!appliedSubscription) throw new PaymentFoundationError("billing_order_invalid");
      await tx.update(commercialBillingOrderLines).set({
        subscriptionId: appliedSubscription.id,
        billingPeriodStartsAt: period.startsAt,
        billingPeriodEndsAt: period.endsAt,
        billingAnchorDay: period.anchor.dayOfMonth,
        billingAnchorIsEndOfMonth: period.anchor.isEndOfMonth,
        updatedAt: event.occurredAt,
      })
        .where(eq(commercialBillingOrderLines.id, line.id));
      allocations.push({ orderLineId: line.id, subscriptionId: appliedSubscription.id });
    }

    await tx.update(commercialPayments).set({ status: "succeeded", providerOccurredAt: event.occurredAt, updatedAt: event.occurredAt })
      .where(and(eq(commercialPayments.id, payment.id), eq(commercialPayments.status, "pending")));
    const settledLines = await tx.select().from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.locationId), asc(commercialBillingOrderLines.id));
    const settledQuoteReference = billingOrderSnapshotReference(order, settledLines);
    await tx.update(commercialBillingOrders).set({ status: "paid", quoteReference: settledQuoteReference, updatedAt: event.occurredAt })
      .where(and(eq(commercialBillingOrders.id, order.id), eq(commercialBillingOrders.status, "pending")));
    return { duplicate: false, paymentId: payment.id, orderId: order.id, allocations };
  });
}

export type TrustedSubscriptionCancellation = {
  providerCode: string;
  /** Stable provider-scoped event identity; stored in the shared event ledger. */
  idempotencyKey: string;
  externalEventId: string | null;
  externalSubscriptionRef: string;
  locationId: string;
  productId: string;
  occurredAt: Date;
  /** Optional period end supplied by the authenticated provider cancellation event. */
  paidThroughAt?: Date | null;
};

function cancellationEventPaymentKey(event: TrustedSubscriptionCancellation): string {
  const payloadIdentity = JSON.stringify([
    event.locationId,
    event.productId,
    event.externalSubscriptionRef,
    event.occurredAt.toISOString(),
    event.paidThroughAt?.toISOString() ?? null,
  ]);
  const digest = createHash("sha256").update(payloadIdentity).digest("hex");
  return `subscription-cancellation:${digest}`;
}

function cancellationEventCondition(event: TrustedSubscriptionCancellation) {
  return event.externalEventId
    ? or(
      and(eq(commercialPaymentEvents.providerCode, event.providerCode), eq(commercialPaymentEvents.idempotencyKey, event.idempotencyKey)),
      and(eq(commercialPaymentEvents.providerCode, event.providerCode), eq(commercialPaymentEvents.externalEventId, event.externalEventId)),
    )
    : and(eq(commercialPaymentEvents.providerCode, event.providerCode), eq(commercialPaymentEvents.idempotencyKey, event.idempotencyKey));
}

function matchesCancellationEvent(row: {
  paymentId: string | null;
  paymentKey: string;
  idempotencyKey: string;
  externalEventId: string | null;
  status: string;
  occurredAt: Date | null;
}, event: TrustedSubscriptionCancellation): boolean {
  return row.paymentId === null &&
    row.paymentKey === cancellationEventPaymentKey(event) &&
    row.idempotencyKey === event.idempotencyKey &&
    row.externalEventId === event.externalEventId &&
    row.status === "canceled" &&
    sameInstant(row.occurredAt, event.occurredAt);
}

/** Applies an authenticated cancellation without removing still-paid access. */
export async function cancelTrustedSubscription(event: TrustedSubscriptionCancellation, db: LifecycleDb = v2Db) {
  if (!event.externalSubscriptionRef.trim() || !event.idempotencyKey.trim() || event.idempotencyKey.length > 512 ||
      (event.externalEventId !== null && (!event.externalEventId.trim() || event.externalEventId.length > 512)) ||
      !Number.isFinite(event.occurredAt.getTime()) ||
      (event.paidThroughAt != null && !Number.isFinite(event.paidThroughAt.getTime()))) {
    throw new PaymentFoundationError("provider_reference_conflict");
  }
  return db.transaction(async (tx) => {
    const eventCondition = cancellationEventCondition(event);
    const [priorEvent] = await tx.select({
      paymentId: commercialPaymentEvents.paymentId,
      paymentKey: commercialPaymentEvents.paymentKey,
      idempotencyKey: commercialPaymentEvents.idempotencyKey,
      externalEventId: commercialPaymentEvents.externalEventId,
      status: commercialPaymentEvents.status,
      occurredAt: commercialPaymentEvents.occurredAt,
    }).from(commercialPaymentEvents).where(eventCondition).limit(1);
    if (priorEvent) {
      if (!matchesCancellationEvent(priorEvent, event)) throw new PaymentFoundationError("payment_event_identity_conflict");
      return { changed: false as const, duplicate: true as const, subscriptionId: null, stale: false as const };
    }

    const [subscription] = await tx.select().from(locationSubscriptions).where(and(
      eq(locationSubscriptions.provider, event.providerCode),
      eq(locationSubscriptions.providerSubscriptionRef, event.externalSubscriptionRef),
      eq(locationSubscriptions.locationId, event.locationId),
      eq(locationSubscriptions.productId, event.productId),
    )).limit(1).for("update");
    if (!subscription) throw new PaymentFoundationError("subscription_not_found");
    const [insertedEvent] = await tx.insert(commercialPaymentEvents).values({
      providerCode: event.providerCode,
      paymentId: null,
      externalEventId: event.externalEventId,
      paymentKey: cancellationEventPaymentKey(event),
      idempotencyKey: event.idempotencyKey,
      status: "canceled",
      occurredAt: event.occurredAt,
    }).onConflictDoNothing().returning({ id: commercialPaymentEvents.id });
    if (!insertedEvent) {
      const [racedEvent] = await tx.select({
        paymentId: commercialPaymentEvents.paymentId,
        paymentKey: commercialPaymentEvents.paymentKey,
        idempotencyKey: commercialPaymentEvents.idempotencyKey,
        externalEventId: commercialPaymentEvents.externalEventId,
        status: commercialPaymentEvents.status,
        occurredAt: commercialPaymentEvents.occurredAt,
      }).from(commercialPaymentEvents).where(eventCondition).limit(1);
      if (!racedEvent || !matchesCancellationEvent(racedEvent, event)) throw new PaymentFoundationError("payment_event_identity_conflict");
      return { changed: false as const, duplicate: true as const, subscriptionId: subscription.id, stale: false as const };
    }
    const [latestPayment] = await tx.select({ occurredAt: commercialPayments.providerOccurredAt }).from(commercialPayments)
      .where(and(eq(commercialPayments.subscriptionId, subscription.id), eq(commercialPayments.status, "succeeded")))
      .orderBy(desc(commercialPayments.providerOccurredAt)).limit(1);
    if ((subscription.canceledAt && event.occurredAt.getTime() <= subscription.canceledAt.getTime()) ||
        (latestPayment?.occurredAt && event.occurredAt.getTime() <= latestPayment.occurredAt.getTime())) {
      return { changed: false as const, duplicate: false as const, subscriptionId: subscription.id, stale: true as const };
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
    return { changed: Boolean(updated), duplicate: false as const, subscriptionId: subscription.id, stale: false as const };
  });
}
