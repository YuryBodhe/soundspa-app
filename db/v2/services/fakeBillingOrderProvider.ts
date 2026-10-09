import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import {
  FAKE_AGGREGATE_CHECKOUT_TTL_MS,
  FAKE_CHECKOUT_TTL_MS,
  FAKE_PAYMENT_CURRENCY,
  FAKE_PROVIDER_CODE,
  FAKE_PROVIDER_ORIGIN,
  fakeProviderIsConfigured,
  issueAggregateFakeCheckoutCapability,
  issueFakeCheckoutTicket,
  verifyAggregateFakeCheckoutCapability,
  verifyFakeCheckoutTicket,
  type FakeProviderEnvironment,
} from "@/lib/v2/fakePaymentProvider";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines,
  commercialBillingOrders,
  commercialPaymentAllocations,
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialPayments,
  commercialPaymentEvents,
  commercialProducts,
  locationCoreTrials,
  locationSubscriptions,
  locations,
  organizations,
  users,
} from "../schema";
import { planNextSubscriptionPeriod } from "./billingCalendar";
import { billingOrderSnapshotReference, quoteBillingRoute, fakeStagingBillingPricingAdapter } from "./billingOrderModel";
import { PaymentFoundationError } from "./paymentFoundation";
import { type AggregateBillingOrderSettlementInput, settleTrustedBillingOrderPayment } from "./paymentLifecycle";
import { LocationBillingAuthorizationError, requireLocationBillingAuthority } from "./locationBillingPermissions";

type FakeBillingOrderDb = Pick<typeof v2Db, "select" | "insert" | "update" | "transaction">;
type FakeBillingOrderTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export type FakeBillingOrderErrorCode =
  | "not_authorized"
  | "checkout_unavailable"
  | "checkout_pending"
  | "checkout_expired"
  | "order_stale"
  | "route_unavailable"
  | "provider_not_configured";

export class FakeBillingOrderError extends Error {
  constructor(readonly code: FakeBillingOrderErrorCode) {
    super(code);
    this.name = "FakeBillingOrderError";
  }
}

function assertConfigured(env: FakeProviderEnvironment) {
  if (!fakeProviderIsConfigured(env)) throw new FakeBillingOrderError("provider_not_configured");
  const secret = env.V2_FAKE_PROVIDER_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new FakeBillingOrderError("provider_not_configured");
  return secret;
}

async function authorizeOrderLocations(tx: FakeBillingOrderTx, userId: string, orderId: string) {
  const [order] = await tx.select().from(commercialBillingOrders)
    .where(eq(commercialBillingOrders.id, orderId)).for("update").limit(1);
  if (!order) throw new FakeBillingOrderError("checkout_unavailable");
  const lines = await tx.select().from(commercialBillingOrderLines)
    .where(eq(commercialBillingOrderLines.orderId, orderId))
    .orderBy(asc(commercialBillingOrderLines.locationId), asc(commercialBillingOrderLines.id)).for("update");
  if (lines.length === 0) throw new FakeBillingOrderError("checkout_unavailable");
  const locationIds = [...new Set(lines.map((line) => line.locationId))].sort();
  const lockedLocations = await tx.select({ id: locations.id, organizationId: locations.organizationId })
    .from(locations).where(and(inArray(locations.id, locationIds), isNull(locations.archivedAt)))
    .orderBy(asc(locations.id)).for("update");
  if (lockedLocations.length !== locationIds.length || lockedLocations.some((location) => location.organizationId !== order.organizationId)) {
    throw new FakeBillingOrderError("not_authorized");
  }
  try {
    for (const locationId of locationIds) {
      const authority = await requireLocationBillingAuthority(tx, userId, locationId);
      if (authority.organizationId !== order.organizationId) throw new FakeBillingOrderError("not_authorized");
    }
  } catch (error) {
    if (error instanceof LocationBillingAuthorizationError) throw new FakeBillingOrderError("not_authorized");
    throw error;
  }
  const [actor] = await tx.select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!actor?.emailVerifiedAt || actor.disabledAt) throw new FakeBillingOrderError("not_authorized");
  return { order, lines, locationIds };
}

function checkoutResponse(input: {
  orderId: string;
  paymentId: string;
  actorId: string;
  expiresAt: Date;
  amountMinor: bigint;
  currency: string;
  providerName: string;
  secret: string;
}) {
  const payerCapability = issueAggregateFakeCheckoutCapability({
    v: 1,
    purpose: "aggregate_fake_checkout_pay",
    orderId: input.orderId,
    paymentId: input.paymentId,
    providerCode: FAKE_PROVIDER_CODE,
    expiresAt: input.expiresAt.getTime(),
  }, input.secret);
  return {
    checkoutId: input.paymentId,
    confirmationToken: issueFakeCheckoutTicket({
      v: 1,
      paymentId: input.paymentId,
      actorHash: createHash("sha256").update(input.actorId).digest("hex"),
      expiresAt: input.expiresAt.getTime(),
    }, input.secret),
    expiresAt: input.expiresAt.toISOString(),
    amountMinor: Number(input.amountMinor),
    currency: input.currency,
    providerName: input.providerName,
    checkoutUrl: `${FAKE_PROVIDER_ORIGIN}/fake-checkout/${payerCapability}`,
  };
}

async function currentCheckout(tx: FakeBillingOrderTx, input: {
  order: typeof commercialBillingOrders.$inferSelect;
  lines: (typeof commercialBillingOrderLines.$inferSelect)[];
  actorId: string;
  now: Date;
  secret: string;
}) {
  const { order, lines, now } = input;
  if (order.status !== "pending" || !order.expiresAt || order.expiresAt.getTime() <= now.getTime()) {
    throw new FakeBillingOrderError("checkout_expired");
  }
  const [payment] = await tx.select().from(commercialPayments).where(eq(commercialPayments.billingOrderId, order.id)).for("update").limit(1);
  const [provider] = await tx.select({ displayName: commercialPaymentProviders.displayName, isEnabled: commercialPaymentProviders.isEnabled })
    .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, FAKE_PROVIDER_CODE)).for("share").limit(1);
  if (!payment || payment.status !== "pending" || payment.providerCode !== FAKE_PROVIDER_CODE || !provider?.isEnabled ||
      payment.amountMinor !== order.totalAmountMinor || payment.currency !== FAKE_PAYMENT_CURRENCY ||
      order.providerCode !== FAKE_PROVIDER_CODE || order.currency !== FAKE_PAYMENT_CURRENCY || lines.some((line) =>
        line.providerCode !== order.providerCode || line.currency !== order.currency)) {
    throw new FakeBillingOrderError("checkout_unavailable");
  }
  if (order.quoteReference !== billingOrderSnapshotReference(order, lines)) throw new FakeBillingOrderError("checkout_unavailable");
  const expiresAt = new Date(payment.createdAt.getTime() + FAKE_AGGREGATE_CHECKOUT_TTL_MS);
  if (expiresAt.getTime() !== order.expiresAt.getTime()) throw new FakeBillingOrderError("checkout_unavailable");
  return checkoutResponse({
    orderId: order.id,
    paymentId: payment.id,
    actorId: input.actorId,
    expiresAt,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    providerName: provider.displayName,
    secret: input.secret,
  });
}

/** Freeze a fresh authorized order and create exactly one aggregate pending payment. */
export async function createFakeProviderBillingOrderCheckout(input: {
  authenticatedUserId: string;
  billingOrderId: string;
}, now = new Date(), db: FakeBillingOrderDb = v2Db, env: FakeProviderEnvironment = process.env) {
  const secret = assertConfigured(env);
  if (!Number.isFinite(now.getTime())) throw new FakeBillingOrderError("checkout_unavailable");
  return db.transaction(async (tx) => {
    const { order, lines } = await authorizeOrderLocations(tx, input.authenticatedUserId, input.billingOrderId);

    if (order.status === "pending") {
      const active = await currentCheckout(tx, { order, lines, actorId: input.authenticatedUserId, now, secret });
      return active;
    }
    if (order.status !== "draft" || lines.length === 0) throw new FakeBillingOrderError("checkout_unavailable");
    if (order.providerCode !== FAKE_PROVIDER_CODE || order.currency !== FAKE_PAYMENT_CURRENCY) throw new FakeBillingOrderError("route_unavailable");

    const [provider] = await tx.select({ displayName: commercialPaymentProviders.displayName, isEnabled: commercialPaymentProviders.isEnabled })
      .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, order.providerCode)).for("share").limit(1);
    if (!provider?.isEnabled) throw new FakeBillingOrderError("route_unavailable");

    // Locking all Location rows in stable order makes the pending order line a
    // reservation and serializes competing aggregate and legacy checkouts.
    const targetPairs = or(...lines.map((line) => and(
      eq(commercialBillingOrderLines.locationId, line.locationId),
      eq(commercialBillingOrderLines.productId, line.productId),
    )));
    const activeOrders = await tx.select({ lineId: commercialBillingOrderLines.id })
      .from(commercialBillingOrderLines)
      .innerJoin(commercialBillingOrders, eq(commercialBillingOrders.id, commercialBillingOrderLines.orderId))
      .where(and(
        targetPairs,
        eq(commercialBillingOrders.status, "pending"),
        gt(commercialBillingOrders.expiresAt, now),
      ));
    if (activeOrders.length > 0) throw new FakeBillingOrderError("checkout_pending");
    const cutoff = new Date(now.getTime() - FAKE_CHECKOUT_TTL_MS);
    const pendingSinglePayments = await tx.select({ id: commercialPayments.id }).from(commercialPayments).where(and(
      or(...lines.map((line) => and(
        eq(commercialPayments.locationId, line.locationId),
        eq(commercialPayments.productId, line.productId),
      ))),
      eq(commercialPayments.providerCode, FAKE_PROVIDER_CODE),
      eq(commercialPayments.status, "pending"),
      gt(commercialPayments.createdAt, cutoff),
      isNull(commercialPayments.billingOrderId),
    ));
    if (pendingSinglePayments.length > 0) throw new FakeBillingOrderError("checkout_pending");

    const productIds = [...new Set(lines.map((line) => line.productId))].sort();
    const products = await tx.select({ id: commercialProducts.id, isActive: commercialProducts.isActive })
      .from(commercialProducts).where(inArray(commercialProducts.id, productIds)).orderBy(asc(commercialProducts.id)).for("share");
    if (products.length !== productIds.length || products.some((product) => !product.isActive)) throw new FakeBillingOrderError("route_unavailable");

    let total = BigInt(0);
    for (const line of lines) {
      const [route] = await tx.select({
        id: commercialPaymentRoutes.id,
        externalReference: commercialPaymentRoutes.externalReference,
        marketCode: commercialPaymentRoutes.marketCode,
        isEnabled: commercialPaymentRoutes.isEnabled,
        providerEnabled: commercialPaymentProviders.isEnabled,
        locationMarketCode: locations.marketCode,
        productActive: commercialProducts.isActive,
        displayOrder: commercialPaymentRoutes.displayOrder,
      }).from(commercialPaymentRoutes)
        .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
        .innerJoin(commercialProducts, eq(commercialProducts.id, commercialPaymentRoutes.productId))
        .innerJoin(locations, eq(locations.id, line.locationId))
        .where(and(
          eq(commercialPaymentRoutes.id, line.routeId),
          eq(commercialPaymentRoutes.productId, line.productId),
          eq(commercialPaymentRoutes.providerCode, line.providerCode),
          eq(commercialPaymentRoutes.marketCode, line.marketCode),
          isNull(locations.archivedAt),
        )).for("share").limit(1);
      if (!route || !route.isEnabled || !route.providerEnabled || !route.productActive ||
          route.externalReference !== line.routeExternalReference || route.marketCode !== route.locationMarketCode ||
          line.providerCode !== order.providerCode || line.currency !== order.currency) {
        throw new FakeBillingOrderError("route_unavailable");
      }
      const quote = quoteBillingRoute({
        routeId: route.id,
        providerCode: line.providerCode,
        marketCode: route.marketCode,
        externalReference: route.externalReference,
        displayOrder: route.displayOrder,
        durationMonths: line.durationMonths,
        env,
      }, [fakeStagingBillingPricingAdapter]);
      const amount = quote ? quote.listAmountMinor - quote.discountAmountMinor : null;
      if (!quote || quote.currency !== order.currency || quote.listAmountMinor !== line.listAmountMinor ||
          quote.discountAmountMinor !== line.discountAmountMinor || amount !== line.amountMinor) {
        throw new FakeBillingOrderError("order_stale");
      }
      total += line.amountMinor;
    }
    if (total !== order.totalAmountMinor || total <= BigInt(0)) throw new FakeBillingOrderError("order_stale");

    // Refresh calendar planning at the moment the quote is accepted, then
    // freeze these per-line anchors/periods together with the payable order.
    for (const line of lines) {
      const subscriptions = await tx.select({
        id: locationSubscriptions.id,
        status: locationSubscriptions.status,
        startsAt: locationSubscriptions.startsAt,
        currentPeriodEndsAt: locationSubscriptions.currentPeriodEndsAt,
        billingAnchorDay: locationSubscriptions.billingAnchorDay,
        billingAnchorIsEndOfMonth: locationSubscriptions.billingAnchorIsEndOfMonth,
      }).from(locationSubscriptions).where(and(
        eq(locationSubscriptions.locationId, line.locationId),
        eq(locationSubscriptions.productId, line.productId),
        isNull(locationSubscriptions.invalidatedByResetId),
        inArray(locationSubscriptions.status, ["active", "canceled"]),
      )).orderBy(desc(locationSubscriptions.currentPeriodEndsAt), desc(locationSubscriptions.startsAt), desc(locationSubscriptions.createdAt), desc(locationSubscriptions.id)).for("update");
      const [trial] = await tx.select({ status: locationCoreTrials.status, startsAt: locationCoreTrials.startsAt, endsAt: locationCoreTrials.endsAt })
        .from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, line.locationId), eq(locationCoreTrials.productId, line.productId), isNull(locationCoreTrials.invalidatedByResetId))).limit(1);
      const period = planNextSubscriptionPeriod({
        now, durationMonths: line.durationMonths,
        subscriptions: subscriptions.map((row) => ({ id: row.id, status: row.status, startsAt: row.startsAt, endsAt: row.currentPeriodEndsAt,
          billingAnchorDay: row.billingAnchorDay, billingAnchorIsEndOfMonth: row.billingAnchorIsEndOfMonth })),
        trial,
      });
      await tx.update(commercialBillingOrderLines).set({
        subscriptionId: period.subscriptionId,
        billingAnchorDay: period.anchor.dayOfMonth,
        billingAnchorIsEndOfMonth: period.anchor.isEndOfMonth,
        billingPeriodStartsAt: period.startsAt,
        billingPeriodEndsAt: period.endsAt,
        updatedAt: now,
      }).where(eq(commercialBillingOrderLines.id, line.id));
    }

    const paymentKey = `fake-billing-order:${order.id}`;
    const externalPaymentId = `fake-billing-payment:${order.id}`;
    const expiresAt = new Date(now.getTime() + FAKE_AGGREGATE_CHECKOUT_TTL_MS);
    const [payment] = await tx.insert(commercialPayments).values({
      billingOrderId: order.id,
      providerCode: order.providerCode,
      paymentKey,
      externalPaymentId,
      status: "pending",
      amountMinor: total,
      currency: order.currency,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!payment) throw new FakeBillingOrderError("checkout_unavailable");
    // Migration 0015's deferred aggregate-payment constraint requires the
    // exact line allocation to exist for pending as well as settled payments.
    await tx.insert(commercialPaymentAllocations).values(lines.map((line) => ({
      orderId: order.id,
      paymentId: payment.id,
      orderLineId: line.id,
      amountMinor: line.amountMinor,
      createdAt: now,
    })));
    const frozenLines = await tx.select().from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.id));
    const quoteReference = billingOrderSnapshotReference(order, frozenLines);
    const [frozenOrder] = await tx.update(commercialBillingOrders).set({
      status: "pending",
      quotedAt: now,
      expiresAt,
      quoteReference,
      providerOrderReference: `fake-order:${order.id}`,
      updatedAt: now,
    }).where(and(eq(commercialBillingOrders.id, order.id), eq(commercialBillingOrders.status, "draft"))).returning({ id: commercialBillingOrders.id });
    if (!frozenOrder) throw new FakeBillingOrderError("checkout_unavailable");
    return checkoutResponse({
      orderId: order.id,
      paymentId: payment.id,
      actorId: input.authenticatedUserId,
      expiresAt,
      amountMinor: total,
      currency: order.currency,
      providerName: provider.displayName,
      secret,
    });
  });
}

/** Reissues the deterministic URL only to a currently authorized order manager. */
export async function getFakeProviderBillingOrderCheckoutLink(input: {
  authenticatedUserId: string;
  billingOrderId: string;
}, now = new Date(), db: FakeBillingOrderDb = v2Db, env: FakeProviderEnvironment = process.env) {
  const secret = assertConfigured(env);
  if (!Number.isFinite(now.getTime())) throw new FakeBillingOrderError("checkout_unavailable");
  return db.transaction(async (tx) => {
    const { order, lines } = await authorizeOrderLocations(tx, input.authenticatedUserId, input.billingOrderId);
    return currentCheckout(tx, { order, lines, actorId: input.authenticatedUserId, now, secret });
  });
}

/** Cancel an unpaid order capability; paid/expired Payments are never reactivated. */
export async function cancelFakeProviderBillingOrderCheckout(input: {
  authenticatedUserId: string;
  billingOrderId: string;
}, now = new Date(), db: FakeBillingOrderDb = v2Db, env: FakeProviderEnvironment = process.env) {
  assertConfigured(env);
  if (!Number.isFinite(now.getTime())) throw new FakeBillingOrderError("checkout_unavailable");
  return db.transaction(async (tx) => {
    const { order } = await authorizeOrderLocations(tx, input.authenticatedUserId, input.billingOrderId);
    const [payment] = await tx.select().from(commercialPayments)
      .where(eq(commercialPayments.billingOrderId, order.id)).for("update").limit(1);
    if (!payment || payment.status !== "pending" || order.status !== "pending") {
      throw new FakeBillingOrderError("checkout_unavailable");
    }
    if (!order.expiresAt || order.expiresAt.getTime() <= now.getTime() ||
        payment.createdAt.getTime() + FAKE_AGGREGATE_CHECKOUT_TTL_MS !== order.expiresAt.getTime()) {
      throw new FakeBillingOrderError("checkout_expired");
    }
    await tx.update(commercialPayments).set({ status: "canceled", updatedAt: now })
      .where(and(eq(commercialPayments.id, payment.id), eq(commercialPayments.status, "pending")));
    await tx.update(commercialBillingOrders).set({ status: "canceled", updatedAt: now })
      .where(and(eq(commercialBillingOrders.id, order.id), eq(commercialBillingOrders.status, "pending")));
    return { canceled: true, billingOrderId: order.id };
  });
}

export type FakeAggregatePayerView = {
  state: "pending" | "already_paid" | "expired" | "canceled";
  organizationName?: string;
  currency?: string;
  totalAmountMinor?: string;
  expiresAt?: string;
  lines?: Array<{ locationName: string; productName: string; durationMonths: number; amountMinor: string }>;
};

/** Public view is intentionally limited to the exact frozen order named by a valid payer capability. */
export async function getFakeBillingOrderPayerView(input: {
  capability: string;
}, now = new Date(), db: FakeBillingOrderDb = v2Db, env: FakeProviderEnvironment = process.env): Promise<FakeAggregatePayerView> {
  const secret = assertConfigured(env);
  const capability = verifyAggregateFakeCheckoutCapability(input.capability, secret);
  if (!capability || !Number.isFinite(now.getTime())) throw new FakeBillingOrderError("checkout_unavailable");
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(commercialBillingOrders).where(eq(commercialBillingOrders.id, capability.orderId)).for("share").limit(1);
    const [payment] = await tx.select().from(commercialPayments).where(eq(commercialPayments.id, capability.paymentId)).for("share").limit(1);
    if (!order || !payment || payment.billingOrderId !== order.id || payment.providerCode !== FAKE_PROVIDER_CODE ||
        order.providerCode !== FAKE_PROVIDER_CODE || payment.locationId || payment.productId || payment.subscriptionId || payment.routeId ||
        capability.providerCode !== order.providerCode || payment.currency !== order.currency || payment.amountMinor !== order.totalAmountMinor ||
        !order.expiresAt || order.expiresAt.getTime() !== capability.expiresAt ||
        payment.createdAt.getTime() + FAKE_AGGREGATE_CHECKOUT_TTL_MS !== capability.expiresAt) {
      throw new FakeBillingOrderError("checkout_unavailable");
    }
    const lines = await tx.select({
      id: commercialBillingOrderLines.id,
      locationName: locations.name,
      productName: commercialProducts.name,
      durationMonths: commercialBillingOrderLines.durationMonths,
      amountMinor: commercialBillingOrderLines.amountMinor,
      providerCode: commercialBillingOrderLines.providerCode,
      currency: commercialBillingOrderLines.currency,
      listAmountMinor: commercialBillingOrderLines.listAmountMinor,
      discountAmountMinor: commercialBillingOrderLines.discountAmountMinor,
    }).from(commercialBillingOrderLines)
      .innerJoin(locations, eq(locations.id, commercialBillingOrderLines.locationId))
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialBillingOrderLines.productId))
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.id));
    const frozenLines = await tx.select().from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.id));
    const allocations = await tx.select({ orderLineId: commercialPaymentAllocations.orderLineId, amountMinor: commercialPaymentAllocations.amountMinor })
      .from(commercialPaymentAllocations).where(and(
        eq(commercialPaymentAllocations.orderId, order.id), eq(commercialPaymentAllocations.paymentId, payment.id),
      ));
    const allocated = new Map(allocations.map((allocation) => [allocation.orderLineId, allocation.amountMinor]));
    if (lines.length === 0 || lines.some((line) => line.providerCode !== order.providerCode || line.currency !== order.currency ||
        line.amountMinor !== line.listAmountMinor - line.discountAmountMinor || allocated.get(line.id) !== line.amountMinor) ||
        allocations.length !== lines.length || lines.reduce((sum, line) => sum + line.amountMinor, BigInt(0)) !== order.totalAmountMinor ||
        order.quoteReference !== billingOrderSnapshotReference(order, frozenLines)) {
      throw new FakeBillingOrderError("checkout_unavailable");
    }
    if (order.status === "paid" && payment.status === "succeeded") return { state: "already_paid" };
    if (order.status === "canceled" || payment.status === "canceled") return { state: "canceled" };
    if (order.status === "expired" || order.status !== "pending" || payment.status !== "pending" || order.expiresAt.getTime() <= now.getTime()) {
      return { state: "expired" };
    }
    const [organization] = await tx.select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, order.organizationId)).limit(1);
    if (!organization) throw new FakeBillingOrderError("checkout_unavailable");
    return {
      state: "pending",
      organizationName: organization.name,
      currency: order.currency,
      totalAmountMinor: order.totalAmountMinor.toString(),
      expiresAt: order.expiresAt.toISOString(),
      lines: lines.map((line) => ({
        locationName: line.locationName,
        productName: line.productName,
        durationMonths: line.durationMonths,
        amountMinor: line.amountMinor.toString(),
      })),
    };
  });
}

/** Anonymous payer operation: the scoped capability authorizes only one fake aggregate payment. */
export async function confirmFakeBillingOrderAsPayer(input: { capability: string }, now = new Date(), db: FakeBillingOrderDb = v2Db, env: FakeProviderEnvironment = process.env) {
  const secret = assertConfigured(env);
  const capability = verifyAggregateFakeCheckoutCapability(input.capability, secret);
  if (!capability || !Number.isFinite(now.getTime())) throw new FakeBillingOrderError("checkout_unavailable");
  return db.transaction(async (tx) => {
    // Keep the global lock order consistent with checkout creation/cancellation: Order, then Payment.
    const [order] = await tx.select().from(commercialBillingOrders)
      .where(eq(commercialBillingOrders.id, capability.orderId)).for("update").limit(1);
    const [payment] = await tx.select().from(commercialPayments)
      .where(eq(commercialPayments.id, capability.paymentId)).for("update").limit(1);
    if (!order || !payment || payment.billingOrderId !== order.id || payment.providerCode !== FAKE_PROVIDER_CODE ||
        order.providerCode !== FAKE_PROVIDER_CODE || payment.locationId || payment.productId || payment.subscriptionId || payment.routeId ||
        capability.providerCode !== order.providerCode || payment.currency !== order.currency || payment.amountMinor !== order.totalAmountMinor ||
        !order.expiresAt || order.expiresAt.getTime() !== capability.expiresAt ||
        payment.createdAt.getTime() + FAKE_AGGREGATE_CHECKOUT_TTL_MS !== capability.expiresAt) {
      throw new FakeBillingOrderError("checkout_unavailable");
    }
    if (order.status === "paid" && payment.status === "succeeded") return { state: "already_paid" as const };
    if (order.status === "canceled" || payment.status === "canceled") return { state: "canceled" as const };
    if (order.status !== "pending" || payment.status !== "pending" || now.getTime() >= capability.expiresAt) {
      return { state: "expired" as const };
    }
    const settlement: AggregateBillingOrderSettlementInput = {
      orderId: order.id,
      paymentId: payment.id,
      providerCode: payment.providerCode,
      paymentKey: payment.paymentKey,
      externalPaymentId: payment.externalPaymentId,
      idempotencyKey: `fake-order-success:${order.id}`,
      externalEventId: `fake-order-success:${order.id}`,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      occurredAt: now,
    };
    try {
      await settleTrustedBillingOrderPayment(settlement, tx);
      return { state: "paid" as const };
    } catch (error) {
      if (error instanceof PaymentFoundationError) throw new FakeBillingOrderError("checkout_unavailable");
      throw error;
    }
  });
}

/** Confirmation is a server-generated success event; client data contains only the actor-bound ticket. */
export async function confirmFakeProviderBillingOrderCheckout(input: {
  authenticatedUserId: string;
  confirmationToken: string;
}, now = new Date(), db: FakeBillingOrderDb = v2Db, env: FakeProviderEnvironment = process.env) {
  const secret = assertConfigured(env);
  const ticket = verifyFakeCheckoutTicket(input.confirmationToken, secret);
  if (!ticket || ticket.actorHash !== createHash("sha256").update(input.authenticatedUserId).digest("hex")) {
    throw new FakeBillingOrderError("checkout_unavailable");
  }
  if (!Number.isFinite(now.getTime())) throw new FakeBillingOrderError("checkout_unavailable");
  return db.transaction(async (tx) => {
    const [identity] = await tx.select({ billingOrderId: commercialPayments.billingOrderId }).from(commercialPayments).where(and(
      eq(commercialPayments.id, ticket.paymentId), eq(commercialPayments.providerCode, FAKE_PROVIDER_CODE),
    )).limit(1);
    if (!identity?.billingOrderId) throw new FakeBillingOrderError("checkout_unavailable");
    // Lock order before payment, matching creation, cancellation, and external payer settlement.
    const [lockedOrder] = await tx.select({ id: commercialBillingOrders.id }).from(commercialBillingOrders)
      .where(eq(commercialBillingOrders.id, identity.billingOrderId)).for("update").limit(1);
    if (!lockedOrder) throw new FakeBillingOrderError("checkout_unavailable");
    const [payment] = await tx.select().from(commercialPayments).where(and(
      eq(commercialPayments.id, ticket.paymentId), eq(commercialPayments.providerCode, FAKE_PROVIDER_CODE),
    )).for("update").limit(1);
    if (!payment?.billingOrderId || payment.locationId || payment.productId || payment.subscriptionId || payment.routeId) {
      throw new FakeBillingOrderError("checkout_unavailable");
    }
    const { order } = await authorizeOrderLocations(tx, input.authenticatedUserId, payment.billingOrderId);
    const expiry = payment.createdAt.getTime() + FAKE_AGGREGATE_CHECKOUT_TTL_MS;
    const alreadySettled = order.status === "paid" && payment.status === "succeeded";
    if (ticket.expiresAt !== expiry || order.expiresAt?.getTime() !== expiry || (!alreadySettled && now.getTime() >= expiry)) {
      throw new FakeBillingOrderError("checkout_expired");
    }
    if (!alreadySettled && (order.status !== "pending" || payment.status !== "pending")) throw new FakeBillingOrderError("checkout_unavailable");
    const [priorSuccess] = alreadySettled ? await tx.select({ occurredAt: commercialPaymentEvents.occurredAt })
      .from(commercialPaymentEvents).where(and(
        eq(commercialPaymentEvents.providerCode, FAKE_PROVIDER_CODE),
        eq(commercialPaymentEvents.idempotencyKey, `fake-order-success:${order.id}`),
      )).limit(1) : [];
    if (alreadySettled && (!priorSuccess?.occurredAt)) throw new FakeBillingOrderError("checkout_unavailable");
    const settlement: AggregateBillingOrderSettlementInput = {
      orderId: order.id,
      paymentId: payment.id,
      providerCode: payment.providerCode,
      paymentKey: payment.paymentKey,
      externalPaymentId: payment.externalPaymentId,
      idempotencyKey: `fake-order-success:${order.id}`,
      externalEventId: `fake-order-success:${order.id}`,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      occurredAt: priorSuccess?.occurredAt ?? now,
    };
    try {
      return await settleTrustedBillingOrderPayment(settlement, tx);
    } catch (error) {
      if (error instanceof PaymentFoundationError) throw new FakeBillingOrderError("checkout_unavailable");
      throw error;
    }
  });
}
