import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { FAKE_PROVIDER_CODE, fakeProviderIsConfigured, type FakeProviderEnvironment } from "@/lib/v2/fakePaymentProvider";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines,
  commercialBillingOrders,
  commercialPaymentProviders,
  commercialPaymentRoutes,
  commercialProducts,
  locationSubscriptions,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import { billingAnchorForDate, planBillingCalendarPeriod } from "./billingCalendar";
import {
  BillingOrderModelError,
  fakeStagingBillingPricingAdapter,
  quoteBillingRoute,
  selectCompatibleBillingQuotes,
  validateBillingOrderRequest,
  type BillingPricingAdapter,
  type BillingRouteQuoteCandidate,
  type RequestedBillingOrderLine,
} from "./billingOrderModel";

type BillingOrderDb = Pick<typeof v2Db, "transaction">;
type BillingOrderTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export type BillingOrderErrorCode =
  | "invalid_request"
  | "duplicate_line"
  | "not_authorized"
  | "product_unavailable"
  | "market_not_configured"
  | "route_unavailable"
  | "provider_not_configured"
  | "unsupported_pricing"
  | "incompatible_routes"
  | "unbounded_subscription_requires_policy";

export class BillingOrderError extends Error {
  constructor(readonly code: BillingOrderErrorCode) {
    super(code);
    this.name = "BillingOrderError";
  }
}

type LocationRow = {
  id: string;
  organizationId: string;
  name: string;
  marketCode: string | null;
};

function rethrowModelError(error: unknown): never {
  if (error instanceof BillingOrderModelError) throw new BillingOrderError(error.code);
  throw error;
}

function requestedLineKey(value: { locationId: string; productId: string }): string {
  return `${value.locationId}:${value.productId}`;
}

async function loadLocationQuotes(input: {
  tx: BillingOrderTx;
  line: RequestedBillingOrderLine;
  location: LocationRow;
  env: FakeProviderEnvironment;
  pricingAdapters: readonly BillingPricingAdapter[];
}): Promise<{ routesFound: boolean; fakeProviderNotConfigured: boolean; quotes: BillingRouteQuoteCandidate[] }> {
  if (!input.location.marketCode) throw new BillingOrderError("market_not_configured");
  const routes = await input.tx.select({
    id: commercialPaymentRoutes.id,
    providerCode: commercialPaymentProviders.code,
    marketCode: commercialPaymentRoutes.marketCode,
    externalReference: commercialPaymentRoutes.externalReference,
    displayOrder: commercialPaymentRoutes.displayOrder,
  }).from(commercialPaymentRoutes)
    .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
    .where(and(
      eq(commercialPaymentRoutes.productId, input.line.productId),
      eq(commercialPaymentRoutes.marketCode, input.location.marketCode),
      eq(commercialPaymentRoutes.isEnabled, true),
      eq(commercialPaymentProviders.isEnabled, true),
    ))
    .orderBy(asc(commercialPaymentRoutes.displayOrder), asc(commercialPaymentProviders.code), asc(commercialPaymentRoutes.externalReference), asc(commercialPaymentRoutes.id))
    .for("share");

  const quotes: BillingRouteQuoteCandidate[] = [];
  let fakeProviderNotConfigured = false;
  for (const route of routes) {
    if (route.providerCode === FAKE_PROVIDER_CODE && !fakeProviderIsConfigured(input.env)) {
      fakeProviderNotConfigured = true;
      continue;
    }
    const quote = quoteBillingRoute({
      routeId: route.id,
      providerCode: route.providerCode,
      marketCode: route.marketCode,
      externalReference: route.externalReference,
      displayOrder: route.displayOrder,
      durationMonths: input.line.durationMonths,
      env: input.env,
    }, input.pricingAdapters);
    if (quote) quotes.push(quote);
  }
  return { routesFound: routes.length > 0, fakeProviderNotConfigured, quotes };
}

async function planLinePeriod(tx: BillingOrderTx, locationId: string, productId: string, durationMonths: number, now: Date) {
  const subscriptions = await tx.select({
    id: locationSubscriptions.id,
    startsAt: locationSubscriptions.startsAt,
    currentPeriodEndsAt: locationSubscriptions.currentPeriodEndsAt,
    billingAnchorDay: locationSubscriptions.billingAnchorDay,
    billingAnchorIsEndOfMonth: locationSubscriptions.billingAnchorIsEndOfMonth,
  }).from(locationSubscriptions)
    .where(and(
      eq(locationSubscriptions.locationId, locationId),
      eq(locationSubscriptions.productId, productId),
      inArray(locationSubscriptions.status, ["active", "canceled"]),
      lte(locationSubscriptions.startsAt, now),
      or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now)),
    ))
    .orderBy(desc(locationSubscriptions.currentPeriodEndsAt), desc(locationSubscriptions.startsAt), desc(locationSubscriptions.createdAt), desc(locationSubscriptions.id))
    .for("update");

  const existing = subscriptions[0];
  if (existing?.currentPeriodEndsAt === null) throw new BillingOrderError("unbounded_subscription_requires_policy");
  const anchor = existing && existing.billingAnchorDay !== null && existing.billingAnchorIsEndOfMonth !== null
    ? { dayOfMonth: existing.billingAnchorDay, isEndOfMonth: existing.billingAnchorIsEndOfMonth }
    : existing ? billingAnchorForDate(existing.startsAt) : null;
  try {
    const period = planBillingCalendarPeriod({
      now,
      durationMonths,
      existingPeriod: existing ? {
        startsAt: existing.startsAt,
        endsAt: existing.currentPeriodEndsAt,
        anchor,
      } : null,
    });
    return { ...period, subscriptionId: existing?.id ?? null };
  } catch (error) {
    if (error instanceof RangeError && error.message === "unbounded_subscription_requires_policy") {
      throw new BillingOrderError("unbounded_subscription_requires_policy");
    }
    throw error;
  }
}

/**
 * Creates an unpaid, non-reserving prepaid order draft. This records a quote
 * snapshot only; it never creates or changes Subscriptions or entitlements.
 */
export async function createPrepaidBillingOrder(input: {
  authenticatedUserId: string;
  organizationId: string;
  lines: readonly RequestedBillingOrderLine[];
}, options: { now?: Date; db?: BillingOrderDb; env?: FakeProviderEnvironment; pricingAdapters?: readonly BillingPricingAdapter[] } = {}) {
  let request: ReturnType<typeof validateBillingOrderRequest>;
  try {
    request = validateBillingOrderRequest({ organizationId: input.organizationId, lines: input.lines });
  } catch (error) {
    rethrowModelError(error);
  }
  if (typeof input.authenticatedUserId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.authenticatedUserId)) {
    throw new BillingOrderError("not_authorized");
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new BillingOrderError("invalid_request");
  const db = options.db ?? v2Db;
  const env = options.env ?? process.env;
  const pricingAdapters = options.pricingAdapters ?? [fakeStagingBillingPricingAdapter];

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
      .from(users).where(eq(users.id, input.authenticatedUserId)).for("share").limit(1);
    const [organization] = await tx.select({ id: organizations.id })
      .from(organizations).where(and(eq(organizations.id, request.organizationId), isNull(organizations.archivedAt))).for("share").limit(1);
    const [membership] = await tx.select({ role: organizationMembers.role })
      .from(organizationMembers).where(and(
        eq(organizationMembers.organizationId, request.organizationId),
        eq(organizationMembers.userId, input.authenticatedUserId),
      )).for("share").limit(1);
    if (!user?.emailVerifiedAt || user.disabledAt || !organization || !membership || !["owner", "admin"].includes(membership.role)) {
      // Manager has no verified Location-scoped billing permission model yet.
      throw new BillingOrderError("not_authorized");
    }

    // Lock Locations in stable order so concurrent drafts touching overlapping
    // Location sets serialize without changing entitlements or reserving checkout.
    const locationIds = [...new Set(request.lines.map((line) => line.locationId))].sort();
    const locationRows = await tx.select({
      id: locations.id,
      organizationId: locations.organizationId,
      name: locations.name,
      marketCode: locations.marketCode,
    }).from(locations).where(and(
      inArray(locations.id, locationIds),
      eq(locations.organizationId, request.organizationId),
      isNull(locations.archivedAt),
    )).orderBy(asc(locations.id)).for("update");
    if (locationRows.length !== locationIds.length) throw new BillingOrderError("not_authorized");
    const locationsById = new Map(locationRows.map((location) => [location.id, location]));

    const productIds = [...new Set(request.lines.map((line) => line.productId))].sort();
    const productRows = await tx.select({ id: commercialProducts.id, name: commercialProducts.name })
      .from(commercialProducts).where(and(inArray(commercialProducts.id, productIds), eq(commercialProducts.isActive, true)))
      .orderBy(asc(commercialProducts.id)).for("share");
    if (productRows.length !== productIds.length) throw new BillingOrderError("product_unavailable");
    const productsById = new Map(productRows.map((product) => [product.id, product]));

    const quotesByLine = new Map<string, BillingRouteQuoteCandidate[]>();
    const routeLookupLines = [...request.lines].sort((left, right) =>
      left.productId.localeCompare(right.productId) ||
      (locationsById.get(left.locationId)?.marketCode ?? "").localeCompare(locationsById.get(right.locationId)?.marketCode ?? "") ||
      left.locationId.localeCompare(right.locationId));
    for (const line of routeLookupLines) {
      const location = locationsById.get(line.locationId);
      if (!location) throw new BillingOrderError("not_authorized");
      const result = await loadLocationQuotes({ tx, line, location, env, pricingAdapters });
      if (!result.routesFound) throw new BillingOrderError("route_unavailable");
      if (result.quotes.length === 0) {
        if (result.fakeProviderNotConfigured) throw new BillingOrderError("provider_not_configured");
        throw new BillingOrderError("unsupported_pricing");
      }
      quotesByLine.set(requestedLineKey(line), result.quotes);
    }

    let selectedQuotes;
    try {
      selectedQuotes = selectCompatibleBillingQuotes(request.lines.map((line) => quotesByLine.get(requestedLineKey(line)) ?? []));
    } catch (error) {
      rethrowModelError(error);
    }
    const providerCode = selectedQuotes[0].providerCode;
    const currency = selectedQuotes[0].currency;
    const totalAmountMinor = selectedQuotes.reduce((sum, quote) => sum + quote.amountMinor, BigInt(0));

    const linePlans = [];
    for (let index = 0; index < request.lines.length; index += 1) {
      const line = request.lines[index];
      const period = await planLinePeriod(tx, line.locationId, line.productId, line.durationMonths, now);
      linePlans.push({
        request: line,
        quote: selectedQuotes[index],
        period,
        location: locationsById.get(line.locationId)!,
        product: productsById.get(line.productId)!,
      });
    }

    const [order] = await tx.insert(commercialBillingOrders).values({
      organizationId: request.organizationId,
      createdByUserId: input.authenticatedUserId,
      status: "draft",
      providerCode,
      currency,
      totalAmountMinor,
      quotedAt: now,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: commercialBillingOrders.id, createdAt: commercialBillingOrders.createdAt });

    const insertedLines = await tx.insert(commercialBillingOrderLines).values(linePlans.map(({ request: line, quote, period }) => ({
      orderId: order.id,
      organizationId: request.organizationId,
      locationId: line.locationId,
      productId: line.productId,
      providerCode,
      currency,
      marketCode: quote.marketCode,
      routeId: quote.routeId,
      routeExternalReference: quote.externalReference,
      durationMonths: line.durationMonths,
      listAmountMinor: quote.listAmountMinor,
      discountAmountMinor: quote.discountAmountMinor,
      amountMinor: quote.amountMinor,
      billingAnchorDay: period.anchor.dayOfMonth,
      billingAnchorIsEndOfMonth: period.anchor.isEndOfMonth,
      billingPeriodStartsAt: period.startsAt,
      billingPeriodEndsAt: period.endsAt,
      subscriptionId: period.subscriptionId,
      createdAt: now,
      updatedAt: now,
    }))).returning({ id: commercialBillingOrderLines.id });

    return {
      id: order.id,
      organizationId: request.organizationId,
      status: "draft" as const,
      providerCode,
      currency,
      totalAmountMinor: totalAmountMinor.toString(),
      createdAt: order.createdAt.toISOString(),
      lines: linePlans.map(({ request: line, quote, period, location, product }, index) => ({
        id: insertedLines[index].id,
        locationId: line.locationId,
        locationName: location.name,
        productId: line.productId,
        productName: product.name,
        durationMonths: line.durationMonths,
        marketCode: quote.marketCode,
        listAmountMinor: quote.listAmountMinor.toString(),
        discountAmountMinor: quote.discountAmountMinor.toString(),
        amountMinor: quote.amountMinor.toString(),
        billingPeriodStartsAt: period.startsAt.toISOString(),
        billingPeriodEndsAt: period.endsAt.toISOString(),
        subscriptionId: period.subscriptionId,
      })),
    };
  });
}
