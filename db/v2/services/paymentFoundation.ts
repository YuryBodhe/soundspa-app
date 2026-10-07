import { and, asc, eq, isNull, or } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialPaymentEvents,
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialPayments,
  commercialProducts,
  locationSubscriptions,
  locations,
} from "../schema";
import { incomingEventIsNewer, samePaymentIdentity, validateNormalizedPaymentInput, type NormalizedPaymentInput } from "./paymentFoundationModel";

type PaymentDb = Pick<typeof v2Db, "select" | "insert" | "update" | "transaction">;

export async function resolveEnabledPaymentRoutesForLocationProduct(locationId: string, productId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  return db.select({
    id: commercialPaymentRoutes.id,
    marketCode: commercialPaymentRoutes.marketCode,
    productId: commercialPaymentRoutes.productId,
    providerCode: commercialPaymentProviders.code,
    providerName: commercialPaymentProviders.displayName,
    externalReference: commercialPaymentRoutes.externalReference,
    displayOrder: commercialPaymentRoutes.displayOrder,
  }).from(commercialPaymentRoutes)
    .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
    .innerJoin(commercialProducts, eq(commercialProducts.id, commercialPaymentRoutes.productId))
    .innerJoin(locations, and(eq(locations.marketCode, commercialPaymentRoutes.marketCode), isNull(locations.archivedAt)))
    .where(and(
      eq(locations.id, locationId),
      eq(commercialPaymentRoutes.productId, productId),
      eq(commercialPaymentRoutes.isEnabled, true),
      eq(commercialPaymentProviders.isEnabled, true),
      eq(commercialProducts.isActive, true),
    ))
    .orderBy(asc(commercialPaymentRoutes.displayOrder), asc(commercialPaymentProviders.code), asc(commercialPaymentRoutes.externalReference), asc(commercialPaymentRoutes.id));
}

export class PaymentFoundationError extends Error {
  constructor(readonly code: "provider_not_found" | "payment_route_mismatch" | "subscription_mismatch" | "payment_identity_conflict" | "payment_event_identity_conflict") {
    super(code);
    this.name = "PaymentFoundationError";
  }
}

/**
 * Records a normalized provider payment and an idempotent event receipt.
 * It intentionally does not create or renew a Subscription or make an access
 * decision. Provider adapters must verify authenticity before calling it.
 */
export async function recordNormalizedPayment(input: NormalizedPaymentInput, db: PaymentDb = v2Db) {
  validateNormalizedPaymentInput(input);
  return db.transaction(async (tx) => {
    const [provider] = await tx.select({ code: commercialPaymentProviders.code })
      .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, input.providerCode)).limit(1);
    if (!provider) throw new PaymentFoundationError("provider_not_found");

    const eventCondition = input.externalEventId
      ? or(
        and(eq(commercialPaymentEvents.providerCode, input.providerCode), eq(commercialPaymentEvents.idempotencyKey, input.idempotencyKey)),
        and(eq(commercialPaymentEvents.providerCode, input.providerCode), eq(commercialPaymentEvents.externalEventId, input.externalEventId)),
      )
      : and(eq(commercialPaymentEvents.providerCode, input.providerCode), eq(commercialPaymentEvents.idempotencyKey, input.idempotencyKey));
    const [priorEvent] = await tx.select({
      paymentId: commercialPaymentEvents.paymentId,
      paymentKey: commercialPaymentEvents.paymentKey,
      status: commercialPaymentEvents.status,
    }).from(commercialPaymentEvents).where(eventCondition).limit(1);
    if (priorEvent) {
      if (priorEvent.paymentKey !== input.paymentKey || priorEvent.status !== input.status || !priorEvent.paymentId) {
        throw new PaymentFoundationError("payment_event_identity_conflict");
      }
      return { duplicate: true as const, paymentId: priorEvent.paymentId };
    }

    const [event] = await tx.insert(commercialPaymentEvents).values({
      providerCode: input.providerCode,
      paymentId: null,
      externalEventId: input.externalEventId,
      paymentKey: input.paymentKey,
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      occurredAt: input.occurredAt,
    }).onConflictDoNothing().returning({ id: commercialPaymentEvents.id });
    if (!event) {
      const [racedEvent] = await tx.select({ paymentId: commercialPaymentEvents.paymentId, paymentKey: commercialPaymentEvents.paymentKey, status: commercialPaymentEvents.status })
        .from(commercialPaymentEvents).where(eventCondition).limit(1);
      if (!racedEvent || racedEvent.paymentKey !== input.paymentKey || racedEvent.status !== input.status || !racedEvent.paymentId) {
        throw new PaymentFoundationError("payment_event_identity_conflict");
      }
      return { duplicate: true as const, paymentId: racedEvent.paymentId };
    }

    if (input.routeId) {
      const [route] = await tx.select({ providerCode: commercialPaymentRoutes.providerCode, productId: commercialPaymentRoutes.productId })
        .from(commercialPaymentRoutes).where(eq(commercialPaymentRoutes.id, input.routeId)).limit(1);
      if (!route || route.providerCode !== input.providerCode || route.productId !== input.productId) {
        throw new PaymentFoundationError("payment_route_mismatch");
      }
    }
    if (input.subscriptionId) {
      const [subscription] = await tx.select({ id: locationSubscriptions.id })
        .from(locationSubscriptions).where(and(
          eq(locationSubscriptions.id, input.subscriptionId),
          eq(locationSubscriptions.locationId, input.locationId),
          eq(locationSubscriptions.productId, input.productId),
          eq(locationSubscriptions.provider, input.providerCode),
        )).limit(1);
      if (!subscription) throw new PaymentFoundationError("subscription_mismatch");
    }

    let [payment] = await tx.select().from(commercialPayments).where(and(
      eq(commercialPayments.providerCode, input.providerCode),
      eq(commercialPayments.paymentKey, input.paymentKey),
    )).limit(1);
    if (!payment && input.externalPaymentId) {
      [payment] = await tx.select().from(commercialPayments).where(and(
        eq(commercialPayments.providerCode, input.providerCode),
        eq(commercialPayments.externalPaymentId, input.externalPaymentId),
      )).limit(1);
    }

    let insertedPayment = false;
    if (!payment) {
      [payment] = await tx.insert(commercialPayments).values({
        locationId: input.locationId,
        productId: input.productId,
        subscriptionId: input.subscriptionId,
        routeId: input.routeId,
        providerCode: input.providerCode,
        paymentKey: input.paymentKey,
        externalPaymentId: input.externalPaymentId,
        externalSubscriptionRef: input.externalSubscriptionRef,
        status: input.status,
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerOccurredAt: input.occurredAt,
      }).onConflictDoNothing().returning();
      insertedPayment = Boolean(payment);
      if (!payment) {
        [payment] = await tx.select().from(commercialPayments).where(or(
          and(eq(commercialPayments.providerCode, input.providerCode), eq(commercialPayments.paymentKey, input.paymentKey)),
          ...(input.externalPaymentId ? [and(eq(commercialPayments.providerCode, input.providerCode), eq(commercialPayments.externalPaymentId, input.externalPaymentId))] : []),
        )).limit(1);
      }
    }
    if (!payment || !samePaymentIdentity(payment, input)) throw new PaymentFoundationError("payment_identity_conflict");
    if (!insertedPayment && incomingEventIsNewer(payment.providerOccurredAt, input.occurredAt)) {
      [payment] = await tx.update(commercialPayments).set({
        status: input.status,
        providerOccurredAt: input.occurredAt,
        updatedAt: new Date(),
      }).where(eq(commercialPayments.id, payment.id)).returning();
    }

    await tx.update(commercialPaymentEvents).set({ paymentId: payment.id }).where(eq(commercialPaymentEvents.id, event.id));
    return { duplicate: false as const, paymentId: payment.id };
  });
}
