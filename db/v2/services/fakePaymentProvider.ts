import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { customerDeviceAuthorizationFailure } from "@/lib/v2/customerDeviceAuthorization";
import {
  fakeConfirmedPaidThrough,
  FAKE_CHECKOUT_TTL_MS,
  FAKE_PAYMENT_AMOUNT_MINOR,
  FAKE_PAYMENT_CURRENCY,
  FAKE_PROVIDER_CODE,
  FAKE_PROVIDER_MARKET,
  fakeCancellationIdentity,
  fakeProviderIsConfigured,
  issueFakeCheckoutTicket,
  verifyFakeCheckoutTicket,
} from "@/lib/v2/fakePaymentProvider";
import { v2Db } from "../client";
import {
  commercialPaymentEvents,
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialPayments,
  commercialProducts,
  locationSubscriptions,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import { resolveEnabledPaymentRoutesForLocationProduct, recordNormalizedPayment } from "./paymentFoundation";
import { cancelTrustedSubscription, settleTrustedProviderPayment } from "./paymentLifecycle";

type FakeProviderDb = Pick<typeof v2Db, "select" | "insert" | "update" | "transaction">;
type FakeProviderTransaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export type FakeProviderErrorCode =
  | "not_authorized"
  | "market_not_configured"
  | "product_unavailable"
  | "route_unavailable"
  | "checkout_pending"
  | "checkout_expired"
  | "checkout_unavailable"
  | "subscription_unavailable"
  | "provider_not_configured";

export class FakeProviderError extends Error {
  constructor(readonly code: FakeProviderErrorCode) {
    super(code);
    this.name = "FakeProviderError";
  }
}

function assertProviderConfigured() {
  if (!fakeProviderIsConfigured(process.env)) throw new FakeProviderError("provider_not_configured");
}

function providerSecret(): string {
  const value = process.env.V2_FAKE_PROVIDER_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) throw new FakeProviderError("provider_not_configured");
  return value;
}

async function authorizeCustomerLocation(tx: FakeProviderTransaction, userId: string, locationId: string) {
  const [user] = await tx.select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
    .from(users).where(eq(users.id, userId)).limit(1);
  const [membership] = await tx.select({
    location: locations,
    organizationId: organizations.id,
    role: organizationMembers.role,
    organizationArchivedAt: organizations.archivedAt,
  }).from(organizationMembers)
    .innerJoin(locations, eq(locations.organizationId, organizationMembers.organizationId))
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(locations.id, locationId)))
    .limit(1);
  const failure = customerDeviceAuthorizationFailure({
    userFound: Boolean(user),
    emailVerified: Boolean(user?.emailVerifiedAt),
    userDisabled: Boolean(user?.disabledAt),
    locationId,
    memberships: membership ? [{
      locationId: membership.location.id,
      role: membership.role,
      locationArchived: Boolean(membership.location.archivedAt),
      organizationArchived: Boolean(membership.organizationArchivedAt),
    }] : [],
  });
  if (failure) throw new FakeProviderError("not_authorized");
  return { location: membership!.location, organizationId: membership!.organizationId };
}

export async function createFakeProviderCheckout(input: {
  authenticatedUserId: string;
  locationId: string;
  productId: string;
  routeId: string;
}, now = new Date(), db: FakeProviderDb = v2Db) {
  assertProviderConfigured();
  const secret = providerSecret();
  return db.transaction(async (tx) => {
    // Locking the Location prevents concurrent checkout requests from both
    // passing the active-pending check for this Location/Product.
    const [lockedLocation] = await tx.select({ id: locations.id })
      .from(locations).where(eq(locations.id, input.locationId)).for("update").limit(1);
    if (!lockedLocation) throw new FakeProviderError("not_authorized");
    const { location } = await authorizeCustomerLocation(tx, input.authenticatedUserId, input.locationId);
    if (!location.marketCode) throw new FakeProviderError("market_not_configured");
    if (location.marketCode !== FAKE_PROVIDER_MARKET) throw new FakeProviderError("route_unavailable");

    const [product] = await tx.select({ id: commercialProducts.id })
      .from(commercialProducts).where(and(eq(commercialProducts.id, input.productId), eq(commercialProducts.isActive, true))).limit(1);
    if (!product) throw new FakeProviderError("product_unavailable");

    const routes = await resolveEnabledPaymentRoutesForLocationProduct(input.locationId, input.productId, tx);
    const selectedRoute = routes.find((route) => route.id === input.routeId && route.providerCode === FAKE_PROVIDER_CODE);
    if (!selectedRoute) throw new FakeProviderError("route_unavailable");

    const cutoff = new Date(now.getTime() - FAKE_CHECKOUT_TTL_MS);
    const [activeCheckout] = await tx.select({ id: commercialPayments.id })
      .from(commercialPayments).where(and(
        eq(commercialPayments.locationId, input.locationId),
        eq(commercialPayments.productId, input.productId),
        eq(commercialPayments.providerCode, FAKE_PROVIDER_CODE),
        eq(commercialPayments.status, "pending"),
        gt(commercialPayments.createdAt, cutoff),
      )).limit(1);
    if (activeCheckout) throw new FakeProviderError("checkout_pending");

    const [existingSubscription] = await tx.select().from(locationSubscriptions)
      .where(and(
        eq(locationSubscriptions.locationId, input.locationId),
        eq(locationSubscriptions.productId, input.productId),
        eq(locationSubscriptions.provider, FAKE_PROVIDER_CODE),
      )).orderBy(desc(locationSubscriptions.createdAt)).limit(1).for("update");
    const identity = randomUUID();
    const paymentKey = `fake-checkout:${identity}`;
    const externalPaymentId = `fake-payment:${identity}`;
    const externalSubscriptionRef = existingSubscription?.providerSubscriptionRef ?? `fake-subscription:${randomUUID()}`;
    const recorded = await recordNormalizedPayment({
      providerCode: FAKE_PROVIDER_CODE,
      paymentKey,
      idempotencyKey: `fake-pending:${identity}`,
      externalEventId: `fake-pending:${identity}`,
      externalPaymentId,
      locationId: input.locationId,
      productId: input.productId,
      subscriptionId: existingSubscription?.id ?? null,
      routeId: input.routeId,
      externalSubscriptionRef,
      status: "pending",
      amountMinor: FAKE_PAYMENT_AMOUNT_MINOR,
      currency: FAKE_PAYMENT_CURRENCY,
      occurredAt: now,
    }, tx);
    const [payment] = await tx.select({ id: commercialPayments.id, createdAt: commercialPayments.createdAt, amountMinor: commercialPayments.amountMinor, currency: commercialPayments.currency })
      .from(commercialPayments).where(eq(commercialPayments.id, recorded.paymentId)).limit(1);
    if (!payment) throw new FakeProviderError("checkout_unavailable");
    const expiresAt = payment.createdAt.getTime() + FAKE_CHECKOUT_TTL_MS;
    const confirmationToken = issueFakeCheckoutTicket({
      v: 1,
      paymentId: payment.id,
      actorHash: createHash("sha256").update(input.authenticatedUserId).digest("hex"),
      expiresAt,
    }, secret);
    return {
      checkoutId: payment.id,
      confirmationToken,
      expiresAt: new Date(expiresAt).toISOString(),
      amountMinor: Number(payment.amountMinor),
      currency: payment.currency,
      providerName: selectedRoute.providerName,
    };
  });
}

export async function confirmFakeProviderCheckout(input: {
  authenticatedUserId: string;
  confirmationToken: string;
}, now = new Date(), db: FakeProviderDb = v2Db) {
  assertProviderConfigured();
  const secret = providerSecret();
  const ticket = verifyFakeCheckoutTicket(input.confirmationToken, secret);
  if (!ticket || ticket.actorHash !== createHash("sha256").update(input.authenticatedUserId).digest("hex")) {
    throw new FakeProviderError("checkout_unavailable");
  }
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(commercialPayments).where(and(
      eq(commercialPayments.id, ticket.paymentId), eq(commercialPayments.providerCode, FAKE_PROVIDER_CODE),
    )).for("update").limit(1);
    if (!payment) throw new FakeProviderError("checkout_unavailable");
    // Aggregate billing-order payments are not Fake Provider single-location
    // checkouts and must never enter this accepted compatibility flow.
    if (!payment.locationId || !payment.productId || payment.billingOrderId) throw new FakeProviderError("checkout_unavailable");
    const { organizationId } = await authorizeCustomerLocation(tx, input.authenticatedUserId, payment.locationId);
    const hardExpiry = payment.createdAt.getTime() + FAKE_CHECKOUT_TTL_MS;
    if (ticket.expiresAt !== hardExpiry || now.getTime() >= hardExpiry) throw new FakeProviderError("checkout_expired");
    if (payment.status !== "pending" && payment.status !== "succeeded") throw new FakeProviderError("checkout_unavailable");

    const [route] = await tx.select({
      externalReference: commercialPaymentRoutes.externalReference,
      isEnabled: commercialPaymentRoutes.isEnabled,
      providerEnabled: commercialPaymentProviders.isEnabled,
      productActive: commercialProducts.isActive,
      marketCode: commercialPaymentRoutes.marketCode,
      locationMarketCode: locations.marketCode,
    }).from(commercialPaymentRoutes)
      .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialPaymentRoutes.productId))
      .innerJoin(locations, eq(locations.id, payment.locationId))
      .where(and(
        eq(commercialPaymentRoutes.id, payment.routeId!),
        eq(commercialPaymentRoutes.productId, payment.productId),
        eq(commercialPaymentRoutes.providerCode, FAKE_PROVIDER_CODE),
        isNull(locations.archivedAt),
      )).limit(1);
    if (!route || !route.isEnabled || !route.providerEnabled || !route.productActive || route.marketCode !== route.locationMarketCode) {
      throw new FakeProviderError("route_unavailable");
    }

    const idempotencyKey = `fake-success:${payment.id}`;
    const [priorEvent] = await tx.select({ occurredAt: commercialPaymentEvents.occurredAt, status: commercialPaymentEvents.status })
      .from(commercialPaymentEvents).where(and(
        eq(commercialPaymentEvents.providerCode, FAKE_PROVIDER_CODE),
        eq(commercialPaymentEvents.idempotencyKey, idempotencyKey),
      )).limit(1);
    if (payment.status === "succeeded" && (!priorEvent || priorEvent.status !== "succeeded" || !priorEvent.occurredAt)) {
      throw new FakeProviderError("checkout_unavailable");
    }
    const occurredAt = priorEvent?.occurredAt ?? now;
    const [currentSubscription] = payment.subscriptionId
      ? await tx.select({ currentPeriodEndsAt: locationSubscriptions.currentPeriodEndsAt })
        .from(locationSubscriptions).where(and(
          eq(locationSubscriptions.id, payment.subscriptionId),
          eq(locationSubscriptions.locationId, payment.locationId),
          eq(locationSubscriptions.productId, payment.productId),
          eq(locationSubscriptions.provider, FAKE_PROVIDER_CODE),
        )).limit(1).for("update")
      : [];
    const result = await settleTrustedProviderPayment({
      providerCode: FAKE_PROVIDER_CODE,
      paymentKey: payment.paymentKey,
      idempotencyKey,
      externalEventId: `fake-success:${payment.id}`,
      externalPaymentId: payment.externalPaymentId,
      locationId: payment.locationId,
      productId: payment.productId,
      subscriptionId: payment.subscriptionId,
      routeId: payment.routeId,
      routeExternalReference: route.externalReference,
      externalSubscriptionRef: payment.externalSubscriptionRef,
      providerCustomerRef: `fake-customer:${organizationId}`,
      status: "succeeded",
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      occurredAt,
      paidThroughAt: fakeConfirmedPaidThrough(occurredAt, currentSubscription?.currentPeriodEndsAt ?? null),
    }, tx);
    return result;
  });
}

export async function cancelFakeProviderSubscription(input: {
  authenticatedUserId: string;
  subscriptionId: string;
}, now = new Date(), db: FakeProviderDb = v2Db) {
  assertProviderConfigured();
  return db.transaction(async (tx) => {
    const [subscription] = await tx.select().from(locationSubscriptions).where(and(
      eq(locationSubscriptions.id, input.subscriptionId),
      eq(locationSubscriptions.provider, FAKE_PROVIDER_CODE),
    )).for("update").limit(1);
    if (!subscription) throw new FakeProviderError("subscription_unavailable");
    await authorizeCustomerLocation(tx, input.authenticatedUserId, subscription.locationId);
    if (!subscription.providerSubscriptionRef || !subscription.currentPeriodEndsAt) {
      throw new FakeProviderError("subscription_unavailable");
    }
    const [latestPayment] = await tx.select({ occurredAt: commercialPayments.providerOccurredAt })
      .from(commercialPayments).where(and(
        eq(commercialPayments.subscriptionId, subscription.id),
        eq(commercialPayments.status, "succeeded"),
      )).orderBy(desc(commercialPayments.providerOccurredAt)).limit(1);
    const occurredAt = subscription.canceledAt ?? new Date(Math.max(
      now.getTime(), (latestPayment?.occurredAt?.getTime() ?? 0) + 1,
    ));
    const identity = fakeCancellationIdentity(subscription.id, subscription.currentPeriodEndsAt);
    return cancelTrustedSubscription({
      providerCode: FAKE_PROVIDER_CODE,
      idempotencyKey: identity.idempotencyKey,
      externalEventId: identity.externalEventId,
      externalSubscriptionRef: subscription.providerSubscriptionRef,
      locationId: subscription.locationId,
      productId: subscription.productId,
      occurredAt,
      paidThroughAt: subscription.currentPeriodEndsAt,
    }, tx);
  });
}
