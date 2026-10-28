import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { FAKE_CHECKOUT_TTL_MS, FAKE_PROVIDER_CODE, fakeProviderIsConfigured, type FakeProviderEnvironment } from "@/lib/v2/fakePaymentProvider";
import { operatorAuthStatus } from "@/lib/v2/adminOperator";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines,
  commercialBillingOrders,
  commercialPaymentAllocations,
  commercialPaymentProviders,
  commercialPayments,
  commercialPaymentRoutes,
  commercialProducts,
  locationCoreTrials,
  locationSubscriptions,
  locations,
  organizations,
  users,
} from "../schema";
import { LocationBillingAuthorizationError, requireLocationBillingAuthority } from "./locationBillingPermissions";
import { planNextSubscriptionPeriod } from "./billingCalendar";
import { requireOrganizationProductPurchaseEligibility } from "./productPurchaseAuthorization";
import { allocateFixedOrganizationTotal, explicitCalendarCoverage, MANUAL_BANK_TRANSFER_PROVIDER_CODE, ManualBillingModelError, validateManualBankTransferInput } from "./manualBillingModel";
import {
  billingOrderSnapshotReference,
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
  | "unbounded_subscription_requires_policy"
  | "checkout_pending"
  | "manual_route_unavailable"
  | "coverage_conflict"
  | "duplicate_request_conflict";

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

type BillingOrderPlan = {
  providerCode: string;
  currency: string;
  totalAmountMinor: bigint;
  linePlans: Array<{
    request: RequestedBillingOrderLine;
    quote: ReturnType<typeof selectCompatibleBillingQuotes>[number];
    period: Awaited<ReturnType<typeof planLinePeriod>>;
    location: LocationRow;
    product: { id: string; name: string; priceMinor: number | null; currency: string | null; billingIntervalMonths: number | null };
  }>;
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
  product: { priceMinor: number | null; currency: string | null; billingIntervalMonths: number | null };
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
      ne(commercialPaymentProviders.code, MANUAL_BANK_TRANSFER_PROVIDER_CODE),
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
      priceMinor: input.product.priceMinor,
      currency: input.product.currency,
      billingIntervalMonths: input.product.billingIntervalMonths,
      env: input.env,
    }, input.pricingAdapters);
    if (quote) quotes.push(quote);
  }
  return { routesFound: routes.length > 0, fakeProviderNotConfigured, quotes };
}

async function planLinePeriod(tx: BillingOrderTx, locationId: string, productId: string, durationMonths: number, now: Date, lockForOrder: boolean) {
  const subscriptions = await tx.select({
    id: locationSubscriptions.id,
    status: locationSubscriptions.status,
    startsAt: locationSubscriptions.startsAt,
    currentPeriodEndsAt: locationSubscriptions.currentPeriodEndsAt,
    billingAnchorDay: locationSubscriptions.billingAnchorDay,
    billingAnchorIsEndOfMonth: locationSubscriptions.billingAnchorIsEndOfMonth,
  }).from(locationSubscriptions)
    .where(and(
      eq(locationSubscriptions.locationId, locationId),
      eq(locationSubscriptions.productId, productId),
      isNull(locationSubscriptions.invalidatedByResetId),
      inArray(locationSubscriptions.status, ["active", "canceled"]),
    ))
    .orderBy(desc(locationSubscriptions.currentPeriodEndsAt), desc(locationSubscriptions.startsAt), desc(locationSubscriptions.createdAt), desc(locationSubscriptions.id))
    .for(lockForOrder ? "update" : "share");
  const [trial] = await tx.select({ status: locationCoreTrials.status, startsAt: locationCoreTrials.startsAt, endsAt: locationCoreTrials.endsAt })
    .from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationId), eq(locationCoreTrials.productId, productId), isNull(locationCoreTrials.invalidatedByResetId))).limit(1);
  try {
    return planNextSubscriptionPeriod({
      now,
      durationMonths,
      subscriptions: subscriptions.map((row) => ({
        id: row.id, status: row.status, startsAt: row.startsAt, endsAt: row.currentPeriodEndsAt,
        billingAnchorDay: row.billingAnchorDay, billingAnchorIsEndOfMonth: row.billingAnchorIsEndOfMonth,
      })),
      trial,
    });
  } catch (error) {
    if (error instanceof RangeError && error.message === "unbounded_subscription_requires_policy") {
      throw new BillingOrderError("unbounded_subscription_requires_policy");
    }
    throw error;
  }
}

async function prepareBillingOrderPlan(input: {
  tx: BillingOrderTx;
  authenticatedUserId: string;
  request: ReturnType<typeof validateBillingOrderRequest>;
  now: Date;
  env: FakeProviderEnvironment;
  pricingAdapters: readonly BillingPricingAdapter[];
  lockForOrder: boolean;
}): Promise<BillingOrderPlan> {
  const { tx, authenticatedUserId, request, now, env, pricingAdapters, lockForOrder } = input;
  const [user] = await tx.select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt })
    .from(users).where(eq(users.id, authenticatedUserId)).for("share").limit(1);
  const [organization] = await tx.select({ id: organizations.id })
    .from(organizations).where(and(eq(organizations.id, request.organizationId), isNull(organizations.archivedAt))).for("share").limit(1);
  if (!user?.emailVerifiedAt || user.disabledAt || !organization) throw new BillingOrderError("not_authorized");

  const locationIds = [...new Set(request.lines.map((line) => line.locationId))].sort();
  const locationRows = await tx.select({
    id: locations.id, organizationId: locations.organizationId, name: locations.name, marketCode: locations.marketCode,
  }).from(locations).where(and(
    inArray(locations.id, locationIds), eq(locations.organizationId, request.organizationId), isNull(locations.archivedAt),
  )).orderBy(asc(locations.id)).for(lockForOrder ? "update" : "share");
  if (locationRows.length !== locationIds.length) throw new BillingOrderError("not_authorized");
  const locationsById = new Map(locationRows.map((location) => [location.id, location]));
  try {
    for (const locationId of locationIds) {
      const authority = await requireLocationBillingAuthority(tx, authenticatedUserId, locationId);
      if (authority.organizationId !== request.organizationId) throw new BillingOrderError("not_authorized");
    }
  } catch (error) {
    if (error instanceof LocationBillingAuthorizationError) throw new BillingOrderError("not_authorized");
    throw error;
  }

  const productIds = [...new Set(request.lines.map((line) => line.productId))].sort();
  await requireOrganizationProductPurchaseEligibility(tx, request.organizationId, productIds, { lockForShare: true });
  const productRows = await tx.select({ id: commercialProducts.id, name: commercialProducts.name, priceMinor: commercialProducts.priceMinor, currency: commercialProducts.currency, billingIntervalMonths: commercialProducts.billingIntervalMonths })
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
    const product = productsById.get(line.productId);
    if (!product) throw new BillingOrderError("product_unavailable");
    const result = await loadLocationQuotes({ tx, line, location, env, pricingAdapters, product });
    if (!result.routesFound) throw new BillingOrderError("route_unavailable");
    if (result.quotes.length === 0) {
      if (result.fakeProviderNotConfigured) throw new BillingOrderError("provider_not_configured");
      throw new BillingOrderError("unsupported_pricing");
    }
    quotesByLine.set(requestedLineKey(line), result.quotes);
  }

  let selectedQuotes: ReturnType<typeof selectCompatibleBillingQuotes>;
  try {
    selectedQuotes = selectCompatibleBillingQuotes(request.lines.map((line) => quotesByLine.get(requestedLineKey(line)) ?? []));
  } catch (error) { rethrowModelError(error); }
  const providerCode = selectedQuotes[0].providerCode;
  const currency = selectedQuotes[0].currency;
  const totalAmountMinor = selectedQuotes.reduce((sum, quote) => sum + quote.amountMinor, BigInt(0));
  const linePlans: BillingOrderPlan["linePlans"] = [];
  for (let index = 0; index < request.lines.length; index += 1) {
    const line = request.lines[index];
    const location = locationsById.get(line.locationId);
    const product = productsById.get(line.productId);
    if (!location || !product) throw new BillingOrderError("invalid_request");
    const period = await planLinePeriod(tx, line.locationId, line.productId, line.durationMonths, now, lockForOrder);
    linePlans.push({ request: line, quote: selectedQuotes[index], period, location, product });
  }
  return { providerCode, currency, totalAmountMinor, linePlans };
}

function validateCreateInput(input: { authenticatedUserId: string; organizationId: string; lines: readonly RequestedBillingOrderLine[] }) {
  let request: ReturnType<typeof validateBillingOrderRequest>;
  try { request = validateBillingOrderRequest({ organizationId: input.organizationId, lines: input.lines }); }
  catch (error) { rethrowModelError(error); }
  if (typeof input.authenticatedUserId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.authenticatedUserId)) {
    throw new BillingOrderError("not_authorized");
  }
  return request;
}

/** Informational preview. Uses the same authorization, pricing, route and calendar planner as draft creation and writes no rows. */
export async function previewPrepaidBillingOrder(input: {
  authenticatedUserId: string;
  organizationId: string;
  lines: readonly RequestedBillingOrderLine[];
}, options: { now?: Date; db?: BillingOrderDb; env?: FakeProviderEnvironment; pricingAdapters?: readonly BillingPricingAdapter[] } = {}) {
  const request = validateCreateInput(input);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new BillingOrderError("invalid_request");
  const db = options.db ?? v2Db;
  const env = options.env ?? process.env;
  const pricingAdapters = options.pricingAdapters ?? [fakeStagingBillingPricingAdapter];
  return db.transaction(async (tx) => {
    const plan = await prepareBillingOrderPlan({ tx, authenticatedUserId: input.authenticatedUserId, request, now, env, pricingAdapters, lockForOrder: false });
    const [organization] = await tx.select({ id: organizations.id, name: organizations.name })
      .from(organizations).where(eq(organizations.id, request.organizationId)).limit(1);
    if (!organization) throw new BillingOrderError("not_authorized");
    return {
      organization,
      providerCode: plan.providerCode,
      currency: plan.currency,
      totalAmountMinor: plan.totalAmountMinor.toString(),
      quotedAt: now.toISOString(),
      quoteValidity: {
        binding: false as const,
        refreshAfter: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        revalidatedAtOrderCreation: true as const,
      },
      lines: plan.linePlans.map(({ request: line, quote, period, location, product }) => ({
        locationId: line.locationId, locationName: location.name,
        productId: line.productId, productName: product.name,
        durationMonths: line.durationMonths, marketCode: quote.marketCode,
        providerCode: quote.providerCode, currency: quote.currency,
        listAmountMinor: quote.listAmountMinor.toString(),
        discountAmountMinor: quote.discountAmountMinor.toString(),
        amountMinor: quote.amountMinor.toString(),
        billingPeriodStartsAt: period.startsAt.toISOString(),
        billingPeriodEndsAt: period.endsAt.toISOString(),
      })),
    };
  });
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
  const request = validateCreateInput(input);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new BillingOrderError("invalid_request");
  const db = options.db ?? v2Db;
  const env = options.env ?? process.env;
  const pricingAdapters = options.pricingAdapters ?? [fakeStagingBillingPricingAdapter];

  return db.transaction(async (tx) => {
    const { providerCode, currency, totalAmountMinor, linePlans } = await prepareBillingOrderPlan({
      tx, authenticatedUserId: input.authenticatedUserId, request, now, env, pricingAdapters, lockForOrder: true,
    });

    // The location rows are locked by prepareBillingOrderPlan. Checkout creation
    // takes the same locks, so this check serializes with a checkout becoming
    // pending and prevents a stale Account page from creating another order.
    const matchingPendingLines = await tx.select({
      locationId: commercialBillingOrderLines.locationId,
      productId: commercialBillingOrderLines.productId,
    }).from(commercialBillingOrderLines)
      .innerJoin(commercialBillingOrders, eq(commercialBillingOrders.id, commercialBillingOrderLines.orderId))
      .innerJoin(commercialPayments, eq(commercialPayments.billingOrderId, commercialBillingOrders.id))
      .where(and(
        inArray(commercialBillingOrderLines.locationId, request.lines.map((line) => line.locationId)),
        inArray(commercialBillingOrderLines.productId, request.lines.map((line) => line.productId)),
        eq(commercialBillingOrderLines.organizationId, request.organizationId),
        eq(commercialBillingOrders.status, "pending"),
        gt(commercialBillingOrders.expiresAt, now),
        eq(commercialPayments.status, "pending"),
      ));
    const requestedPairs = new Set(request.lines.map((line) => requestedLineKey(line)));
    const legacyCutoff = new Date(now.getTime() - FAKE_CHECKOUT_TTL_MS);
    const matchingPendingLegacyPayments = await tx.select({
      locationId: commercialPayments.locationId,
      productId: commercialPayments.productId,
    }).from(commercialPayments).where(and(
      inArray(commercialPayments.locationId, request.lines.map((line) => line.locationId)),
      inArray(commercialPayments.productId, request.lines.map((line) => line.productId)),
      eq(commercialPayments.providerCode, FAKE_PROVIDER_CODE),
      eq(commercialPayments.status, "pending"),
      isNull(commercialPayments.billingOrderId),
      gt(commercialPayments.createdAt, legacyCutoff),
    ));
    if (matchingPendingLines.some((line) => requestedPairs.has(requestedLineKey(line))) ||
        matchingPendingLegacyPayments.some((payment) => payment.locationId && payment.productId && requestedPairs.has(requestedLineKey({ locationId: payment.locationId, productId: payment.productId })))) {
      throw new BillingOrderError("checkout_pending");
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

    const snapshotLines = await tx.select().from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.id));
    const quoteReference = billingOrderSnapshotReference({
      id: order.id, organizationId: request.organizationId, providerCode, currency, totalAmountMinor,
    }, snapshotLines);
    await tx.update(commercialBillingOrders).set({ quoteReference, updatedAt: now })
      .where(eq(commercialBillingOrders.id, order.id));

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

/**
 * Creates the pending order and expected transfer allocation for one
 * organization-wide, operator-issued bank transfer. It does not mark money as
 * received and does not grant or mutate entitlement records.
 */
export async function createManualBankTransferBillingOrder(input: {
  organizationId: unknown;
  operatorAuthorization: unknown;
  reason: unknown;
  idempotencyKey: unknown;
  periodStart: unknown;
  durationMonths: unknown;
  currency: unknown;
  totalAmountMinor: unknown;
  invoiceNumber: unknown;
  invoiceIssuedAt: unknown;
  paymentDueAt: unknown;
  lines: unknown;
}, options: { now?: Date; db?: BillingOrderDb } = {}) {
  let request: ReturnType<typeof validateManualBankTransferInput>;
  const authorization = typeof input.operatorAuthorization === "string" ? input.operatorAuthorization : null;
  const operator = process.env.V2_ADMIN_USERNAME?.trim();
  if (!operator || operator.length > 200 || operatorAuthStatus(authorization) !== 200) throw new BillingOrderError("not_authorized");
  try { request = validateManualBankTransferInput({ ...input, operator }); }
  catch (error) {
    if (error instanceof ManualBillingModelError) throw new BillingOrderError(error.code === "invalid_creator" ? "invalid_request" : error.code === "invalid_period" ? "invalid_request" : error.code === "invalid_amount" ? "invalid_request" : error.code);
    throw error;
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new BillingOrderError("invalid_request");
  const db = options.db ?? v2Db;
  const allocated = allocateFixedOrganizationTotal(request.totalAmountMinor, request.lines);
  const coverage = explicitCalendarCoverage(request.periodStart, request.durationMonths);

  return db.transaction(async (tx) => {
    // Stable lock prevents two concurrent retries from creating duplicate
    // orders before the unique idempotency index is consulted.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${request.idempotencyKey}, 0))`);
    const [prior] = await tx.select().from(commercialBillingOrders).where(and(
      eq(commercialBillingOrders.providerCode, MANUAL_BANK_TRANSFER_PROVIDER_CODE),
      eq(commercialBillingOrders.manualIdempotencyKey, request.idempotencyKey),
    )).for("update").limit(1);
    if (prior) {
      const priorLines = await tx.select().from(commercialBillingOrderLines).where(eq(commercialBillingOrderLines.orderId, prior.id))
        .orderBy(asc(commercialBillingOrderLines.locationId), asc(commercialBillingOrderLines.productId));
      const sameRequest = prior.organizationId === request.organizationId && prior.currency === request.currency &&
        prior.totalAmountMinor === request.totalAmountMinor && prior.createdByOperator === request.operator && prior.creationReason === request.reason &&
        prior.externalInvoiceNumber === request.invoiceNumber && prior.invoiceIssuedAt?.getTime() === request.invoiceIssuedAt.getTime() &&
        prior.paymentDueAt?.getTime() === request.paymentDueAt.getTime() &&
        priorLines.length === allocated.length && priorLines.every((line, index) =>
          line.locationId === allocated[index].locationId && line.productId === allocated[index].productId &&
          line.amountMinor === allocated[index].amountMinor && line.durationMonths === request.durationMonths &&
          line.billingPeriodStartsAt?.getTime() === coverage.startsAt.getTime() && line.billingPeriodEndsAt?.getTime() === coverage.endsAt.getTime());
      if (!sameRequest) throw new BillingOrderError("duplicate_request_conflict");
      const [payment] = await tx.select({ id: commercialPayments.id, status: commercialPayments.status,
        amountMinor: commercialPayments.amountMinor, currency: commercialPayments.currency }).from(commercialPayments)
        .where(eq(commercialPayments.billingOrderId, prior.id)).limit(1);
      if (!payment || payment.amountMinor !== prior.totalAmountMinor || payment.currency !== prior.currency ||
          !["pending", "succeeded"].includes(payment.status)) throw new BillingOrderError("invalid_request");
      const priorAllocations = await tx.select({ orderLineId: commercialPaymentAllocations.orderLineId,
        amountMinor: commercialPaymentAllocations.amountMinor }).from(commercialPaymentAllocations)
        .where(and(eq(commercialPaymentAllocations.paymentId, payment.id), eq(commercialPaymentAllocations.orderId, prior.id)));
      if (priorAllocations.length !== priorLines.length || priorLines.some((line) =>
        priorAllocations.find((allocation) => allocation.orderLineId === line.id)?.amountMinor !== line.amountMinor)) {
        throw new BillingOrderError("invalid_request");
      }
      return { id: prior.id, paymentId: payment.id, duplicate: true as const, status: prior.status, totalAmountMinor: prior.totalAmountMinor.toString() };
    }

    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(and(eq(organizations.id, request.organizationId), isNull(organizations.archivedAt))).for("update").limit(1);
    if (!organization) throw new BillingOrderError("not_authorized");
    const locationIds = allocated.map((line) => line.locationId).sort();
    const locationRows = await tx.select({ id: locations.id, organizationId: locations.organizationId, marketCode: locations.marketCode, archivedAt: locations.archivedAt })
      .from(locations).where(inArray(locations.id, locationIds)).orderBy(asc(locations.id)).for("update");
    if (locationRows.length !== 3 || locationRows.some((location) => location.organizationId !== request.organizationId || location.archivedAt !== null || !location.marketCode)) {
      throw new BillingOrderError("not_authorized");
    }
    const locationById = new Map(locationRows.map((location) => [location.id, location]));
    const productIds = [...new Set(allocated.map((line) => line.productId))].sort();
    await requireOrganizationProductPurchaseEligibility(tx, request.organizationId, productIds, { lockForShare: true });
    const products = await tx.select({ id: commercialProducts.id, isActive: commercialProducts.isActive })
      .from(commercialProducts).where(inArray(commercialProducts.id, productIds)).orderBy(asc(commercialProducts.id)).for("share");
    if (products.length !== productIds.length || products.some((product) => !product.isActive)) throw new BillingOrderError("product_unavailable");

    const [provider] = await tx.select({ code: commercialPaymentProviders.code, isEnabled: commercialPaymentProviders.isEnabled })
      .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, MANUAL_BANK_TRANSFER_PROVIDER_CODE)).for("share").limit(1);
    if (!provider?.isEnabled) throw new BillingOrderError("provider_not_configured");

    const routes = await tx.select({ id: commercialPaymentRoutes.id, productId: commercialPaymentRoutes.productId,
      marketCode: commercialPaymentRoutes.marketCode, externalReference: commercialPaymentRoutes.externalReference })
      .from(commercialPaymentRoutes).where(and(
        eq(commercialPaymentRoutes.providerCode, MANUAL_BANK_TRANSFER_PROVIDER_CODE),
        eq(commercialPaymentRoutes.isEnabled, true),
        inArray(commercialPaymentRoutes.productId, productIds),
        inArray(commercialPaymentRoutes.marketCode, locationRows.map((location) => location.marketCode!)),
      )).orderBy(asc(commercialPaymentRoutes.productId), asc(commercialPaymentRoutes.marketCode), asc(commercialPaymentRoutes.id)).for("share");
    const routeByPair = new Map(routes.map((route) => [`${route.productId}:${route.marketCode}`, route]));
    for (const line of allocated) {
      const location = locationById.get(line.locationId)!;
      if (!routeByPair.has(`${line.productId}:${location.marketCode}`)) throw new BillingOrderError("manual_route_unavailable");
    }

    // Refuse overlapping manual coverage and duplicate active coverage. The
    // unique request key handles retries; this interval check protects against
    // a second invoice generated with a different request key.
    for (const line of allocated) {
      const [overlappingSubscription] = await tx.select({ id: locationSubscriptions.id }).from(locationSubscriptions).where(and(
        eq(locationSubscriptions.locationId, line.locationId), eq(locationSubscriptions.productId, line.productId),
        isNull(locationSubscriptions.invalidatedByResetId), inArray(locationSubscriptions.status, ["active", "canceled"]),
        sql`(${locationSubscriptions.currentPeriodEndsAt} IS NULL OR (${locationSubscriptions.startsAt} < ${coverage.endsAt} AND ${locationSubscriptions.currentPeriodEndsAt} > ${coverage.startsAt}))`,
      )).for("update").limit(1);
      if (overlappingSubscription) throw new BillingOrderError("coverage_conflict");
      const [overlappingTrial] = await tx.select({ id: locationCoreTrials.id }).from(locationCoreTrials).where(and(
        eq(locationCoreTrials.locationId, line.locationId), eq(locationCoreTrials.productId, line.productId),
        isNull(locationCoreTrials.invalidatedByResetId),
        sql`${locationCoreTrials.startsAt} < ${coverage.endsAt} AND ${locationCoreTrials.endsAt} > ${coverage.startsAt}`,
      )).limit(1);
      if (overlappingTrial) throw new BillingOrderError("coverage_conflict");
      const [overlappingOrderLine] = await tx.select({ id: commercialBillingOrderLines.id }).from(commercialBillingOrderLines)
        .innerJoin(commercialBillingOrders, eq(commercialBillingOrders.id, commercialBillingOrderLines.orderId))
        .where(and(eq(commercialBillingOrders.organizationId, request.organizationId),
          inArray(commercialBillingOrders.status, ["pending", "paid"]),
          eq(commercialBillingOrderLines.providerCode, MANUAL_BANK_TRANSFER_PROVIDER_CODE),
          eq(commercialBillingOrderLines.locationId, line.locationId), eq(commercialBillingOrderLines.productId, line.productId),
          sql`${commercialBillingOrderLines.billingPeriodStartsAt} < ${coverage.endsAt} AND ${commercialBillingOrderLines.billingPeriodEndsAt} > ${coverage.startsAt}`))
        .for("update").limit(1);
      if (overlappingOrderLine) throw new BillingOrderError("coverage_conflict");
    }

    const [order] = await tx.insert(commercialBillingOrders).values({
      organizationId: request.organizationId, createdByUserId: null, createdByOperator: request.operator,
      creationReason: request.reason, manualIdempotencyKey: request.idempotencyKey,
      status: "pending", providerCode: MANUAL_BANK_TRANSFER_PROVIDER_CODE, currency: request.currency,
      totalAmountMinor: request.totalAmountMinor, externalInvoiceNumber: request.invoiceNumber,
      invoiceIssuedAt: request.invoiceIssuedAt, paymentDueAt: request.paymentDueAt,
      quotedAt: now, createdAt: now, updatedAt: now,
    }).returning({ id: commercialBillingOrders.id });
    const insertedLines = await tx.insert(commercialBillingOrderLines).values(allocated.map((line) => {
      const location = locationById.get(line.locationId)!;
      const route = routeByPair.get(`${line.productId}:${location.marketCode}`)!;
      return {
        orderId: order.id, organizationId: request.organizationId, locationId: line.locationId, productId: line.productId,
        providerCode: MANUAL_BANK_TRANSFER_PROVIDER_CODE, currency: request.currency, marketCode: location.marketCode!,
        routeId: route.id, routeExternalReference: route.externalReference, durationMonths: request.durationMonths,
        listAmountMinor: line.amountMinor, discountAmountMinor: BigInt(0), amountMinor: line.amountMinor,
        billingAnchorDay: coverage.anchor.dayOfMonth, billingAnchorIsEndOfMonth: coverage.anchor.isEndOfMonth,
        billingPeriodStartsAt: coverage.startsAt, billingPeriodEndsAt: coverage.endsAt, subscriptionId: null,
        createdAt: now, updatedAt: now,
      };
    })).returning({ id: commercialBillingOrderLines.id, amountMinor: commercialBillingOrderLines.amountMinor });
    const [payment] = await tx.insert(commercialPayments).values({
      billingOrderId: order.id, providerCode: MANUAL_BANK_TRANSFER_PROVIDER_CODE,
      paymentKey: `manual-order:${order.id}`, status: "pending", amountMinor: request.totalAmountMinor,
      currency: request.currency, createdAt: now, updatedAt: now,
    }).returning({ id: commercialPayments.id });
    await tx.insert(commercialPaymentAllocations).values(insertedLines.map((line) => ({
      orderId: order.id, paymentId: payment.id, orderLineId: line.id, amountMinor: line.amountMinor, createdAt: now,
    })));
    const snapshotLines = await tx.select().from(commercialBillingOrderLines).where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.id));
    const quoteReference = billingOrderSnapshotReference({
      id: order.id, organizationId: request.organizationId, providerCode: MANUAL_BANK_TRANSFER_PROVIDER_CODE,
      currency: request.currency, totalAmountMinor: request.totalAmountMinor,
    }, snapshotLines);
    await tx.update(commercialBillingOrders).set({ quoteReference, updatedAt: now }).where(eq(commercialBillingOrders.id, order.id));
    return { id: order.id, paymentId: payment.id, duplicate: false as const, status: "pending" as const,
      totalAmountMinor: request.totalAmountMinor.toString(), currency: request.currency,
      lines: allocated.map((line) => ({ ...line, amountMinor: line.amountMinor.toString(), startsAt: coverage.startsAt.toISOString(), endsAt: coverage.endsAt.toISOString() })) };
  });
}
