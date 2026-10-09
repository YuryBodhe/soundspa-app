import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { normalizeMarketCode, resolveCustomerBillingStatus, shouldShowCustomerBillingProduct } from "@/lib/v2/customerBillingModel";
import { FAKE_PROVIDER_CODE } from "@/lib/v2/fakePaymentProvider";
import { v2Db } from "../client";
import {
  commercialPartnerBenefits,
  commercialPartners,
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialProducts,
  locationCoreTrials,
  locationSubscriptions,
  locationBillingPermissions,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import { resolveEnabledPaymentRoutesForLocationProduct } from "./paymentFoundation";

export class CustomerBillingError extends Error {
  constructor(readonly code: "not_authorized" | "market_unavailable" | "invalid_market") {
    super(code);
    this.name = "CustomerBillingError";
  }
}

export async function listCustomerBilling(userId: string, now = new Date(), db: Pick<typeof v2Db, "select" | "selectDistinct"> = v2Db) {
  const authorizedLocations = await db.select({
    id: locations.id,
    organizationName: organizations.name,
    organizationId: organizations.id,
    organizationArchivedAt: organizations.archivedAt,
    name: locations.name,
    timezone: locations.timezone,
    marketCode: locations.marketCode,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(locations, eq(locations.organizationId, organizations.id))
    .leftJoin(locationBillingPermissions, and(
      eq(locationBillingPermissions.locationId, locations.id),
      eq(locationBillingPermissions.organizationId, organizations.id),
      eq(locationBillingPermissions.userId, userId),
    ))
    .where(and(
      eq(organizationMembers.userId, userId),
      or(
        inArray(organizationMembers.role, ["owner", "admin"]),
        and(eq(organizationMembers.role, "manager"), isNotNull(locationBillingPermissions.userId)),
      ),
      isNull(users.disabledAt),
      isNull(organizations.archivedAt),
      isNull(locations.archivedAt),
    )).orderBy(asc(organizations.name), asc(locations.name), asc(locations.id));

  const products = await db.select({ id: commercialProducts.id, name: commercialProducts.name })
    .from(commercialProducts).where(eq(commercialProducts.isActive, true))
    .orderBy(asc(commercialProducts.name), asc(commercialProducts.id));

  const marketRows = await db.selectDistinct({ marketCode: commercialPaymentRoutes.marketCode })
    .from(commercialPaymentRoutes)
    .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
    .innerJoin(commercialProducts, eq(commercialProducts.id, commercialPaymentRoutes.productId))
    .where(and(
      eq(commercialPaymentRoutes.providerCode, FAKE_PROVIDER_CODE),
      eq(commercialPaymentRoutes.isEnabled, true), eq(commercialPaymentProviders.isEnabled, true), eq(commercialProducts.isActive, true),
    ))
    .orderBy(asc(commercialPaymentRoutes.marketCode));
  const supportedMarkets = marketRows.map((row) => row.marketCode);

  const result = [];
  for (const location of authorizedLocations) {
    const cards = [];
    const partnerBenefitRows = await db.select({
      id: commercialPartnerBenefits.id,
      partnerName: commercialPartners.name,
      productId: commercialPartnerBenefits.productId,
      productName: commercialProducts.name,
      startsAt: commercialPartnerBenefits.startsAt,
      endsAt: commercialPartnerBenefits.endsAt,
    }).from(commercialPartnerBenefits)
      .innerJoin(commercialPartners, and(eq(commercialPartners.id, commercialPartnerBenefits.partnerId), eq(commercialPartners.isActive, true)))
      .innerJoin(commercialProducts, and(eq(commercialProducts.id, commercialPartnerBenefits.productId), eq(commercialProducts.isActive, true)))
      .where(and(
        eq(commercialPartnerBenefits.locationId, location.id),
        or(isNull(commercialPartnerBenefits.endsAt), gt(commercialPartnerBenefits.endsAt, now)),
      )).orderBy(asc(commercialPartnerBenefits.startsAt), asc(commercialPartnerBenefits.id));
    for (const product of products) {
      const [trial] = await db.select({ status: locationCoreTrials.status, startsAt: locationCoreTrials.startsAt, endsAt: locationCoreTrials.endsAt })
        .from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, location.id), eq(locationCoreTrials.productId, product.id), isNull(locationCoreTrials.invalidatedByResetId))).limit(1);
      const subscriptions = await db.select({
        id: locationSubscriptions.id,
        status: locationSubscriptions.status,
        startsAt: locationSubscriptions.startsAt,
        currentPeriodEndsAt: locationSubscriptions.currentPeriodEndsAt,
        canceledAt: locationSubscriptions.canceledAt,
        provider: locationSubscriptions.provider,
        providerSubscriptionRef: locationSubscriptions.providerSubscriptionRef,
      }).from(locationSubscriptions).where(and(eq(locationSubscriptions.locationId, location.id), eq(locationSubscriptions.productId, product.id), isNull(locationSubscriptions.invalidatedByResetId)))
        .orderBy(desc(locationSubscriptions.createdAt), desc(locationSubscriptions.id));
      const subscription = subscriptions.find((candidate) => resolveCustomerBillingStatus({ subscription: candidate }, now) === "subscription") ??
        subscriptions.find((candidate) => (candidate.status === "active" || candidate.status === "canceled") &&
          candidate.startsAt > now && candidate.currentPeriodEndsAt !== null && candidate.currentPeriodEndsAt > candidate.startsAt) ??
        subscriptions[0] ?? null;
      const benefits = await db.select({ startsAt: commercialPartnerBenefits.startsAt, endsAt: commercialPartnerBenefits.endsAt })
        .from(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.locationId, location.id), eq(commercialPartnerBenefits.productId, product.id))).orderBy(desc(commercialPartnerBenefits.startsAt));
      const benefit = benefits.find((candidate) => resolveCustomerBillingStatus({ partnerBenefit: candidate }, now) === "partner") ?? benefits[0] ?? null;
      const status = resolveCustomerBillingStatus({ trial, subscription, partnerBenefit: benefit }, now);
      if (!shouldShowCustomerBillingProduct(status)) continue;
      const routes = location.marketCode
        ? await resolveEnabledPaymentRoutesForLocationProduct(location.id, product.id, db)
        : [];
      cards.push({
        productId: product.id,
        productName: product.name,
        status,
        trialEndsAt: trial?.endsAt.toISOString() ?? null,
        paidStartsAt: subscription?.startsAt.toISOString() ?? null,
        paidThrough: subscription?.currentPeriodEndsAt?.toISOString() ?? null,
        trialActive: Boolean(trial?.status === "active" && trial.startsAt <= now && trial.endsAt > now),
        scheduledPaidPeriods: subscriptions.filter((candidate) =>
          (candidate.status === "active" || candidate.status === "canceled") && candidate.startsAt > now &&
          candidate.currentPeriodEndsAt !== null && candidate.currentPeriodEndsAt > candidate.startsAt,
        ).map((candidate) => ({ startsAt: candidate.startsAt.toISOString(), endsAt: candidate.currentPeriodEndsAt!.toISOString() })),
        // A null provider reference represents prepaid coverage; it must not
        // be presented as a cancellable recurring renewal in the Account UI.
        subscriptionId: status === "subscription" && subscription?.provider === FAKE_PROVIDER_CODE && subscription.providerSubscriptionRef ? subscription.id : null,
        subscriptionCanceled: status === "subscription" ? Boolean(subscription?.canceledAt || subscription?.status === "canceled") : false,
        routes: routes.filter((route) => route.providerCode === FAKE_PROVIDER_CODE)
          .map((route) => ({ id: route.id, providerName: route.providerName })),
      });
    }
    result.push({
      id: location.id,
      organizationId: location.organizationId,
      organizationName: location.organizationName,
      name: location.name,
      timezone: location.timezone,
      marketCode: location.marketCode,
      products: cards,
      partnerBenefits: partnerBenefitRows.map((benefit) => ({
        id: benefit.id,
        partnerName: benefit.partnerName,
        productId: benefit.productId,
        productName: benefit.productName,
        startsAt: benefit.startsAt.toISOString(),
        endsAt: benefit.endsAt?.toISOString() ?? null,
      })),
    });
  }
  return { locations: result, supportedMarkets };
}

export async function updateCustomerLocationMarket(input: { userId: string; locationId: string; marketCode: unknown }) {
  const marketCode = normalizeMarketCode(input.marketCode);
  if (!marketCode) throw new CustomerBillingError("invalid_market");
  return v2Db.transaction(async (tx) => {
    const [membership] = await tx.select({ locationId: locations.id })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .innerJoin(locations, eq(locations.organizationId, organizations.id))
      .where(and(
        eq(organizationMembers.userId, input.userId),
        inArray(organizationMembers.role, ["owner", "admin"]),
        eq(locations.id, input.locationId),
        isNull(users.disabledAt),
        isNull(organizations.archivedAt),
        isNull(locations.archivedAt),
      )).limit(1);
    if (!membership) throw new CustomerBillingError("not_authorized");
    const [configuredMarket] = await tx.select({ marketCode: commercialPaymentRoutes.marketCode })
      .from(commercialPaymentRoutes)
      .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialPaymentRoutes.productId))
      .where(and(
        eq(commercialPaymentRoutes.marketCode, marketCode),
        eq(commercialPaymentRoutes.providerCode, FAKE_PROVIDER_CODE),
        eq(commercialPaymentRoutes.isEnabled, true),
        eq(commercialPaymentProviders.isEnabled, true),
        eq(commercialProducts.isActive, true),
      )).limit(1);
    if (!configuredMarket) throw new CustomerBillingError("market_unavailable");
    const [updated] = await tx.update(locations).set({ marketCode, updatedAt: new Date() })
      .where(eq(locations.id, input.locationId)).returning({ id: locations.id, marketCode: locations.marketCode });
    return updated;
  });
}
