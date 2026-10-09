import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines,
  commercialBillingOrders,
  commercialPayments,
  commercialProducts,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import { requireLocationBillingAuthority, LocationBillingAuthorizationError } from "./locationBillingPermissions";
import { resolveBillingOrderState } from "./billingOrderReadModel";

type ReadTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type ReadDb = Pick<typeof v2Db, "transaction">;

export class BillingOrderReadError extends Error {
  constructor(readonly code: "not_found" | "invalid_cursor") {
    super(code);
    this.name = "BillingOrderReadError";
  }
}

type Cursor = { createdAt: Date; id: string };
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : new Date(NaN);
    if (!Number.isFinite(createdAt.getTime()) || typeof parsed.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error("invalid");
    }
    return { createdAt, id: parsed.id };
  } catch { throw new BillingOrderReadError("invalid_cursor"); }
}
function encodeCursor(row: Cursor): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}

async function requireVisibleOrder(tx: ReadTx, userId: string, orderId: string) {
  const [order] = await tx.select({
    id: commercialBillingOrders.id,
    organizationId: commercialBillingOrders.organizationId,
    organizationName: organizations.name,
    status: commercialBillingOrders.status,
    providerCode: commercialBillingOrders.providerCode,
    currency: commercialBillingOrders.currency,
    totalAmountMinor: commercialBillingOrders.totalAmountMinor,
    createdAt: commercialBillingOrders.createdAt,
    quotedAt: commercialBillingOrders.quotedAt,
    expiresAt: commercialBillingOrders.expiresAt,
    updatedAt: commercialBillingOrders.updatedAt,
  }).from(commercialBillingOrders)
    .innerJoin(organizations, eq(organizations.id, commercialBillingOrders.organizationId))
    .where(and(eq(commercialBillingOrders.id, orderId), isNull(organizations.archivedAt))).limit(1);
  if (!order) throw new BillingOrderReadError("not_found");
  const lines = await tx.select({
    id: commercialBillingOrderLines.id,
    organizationId: commercialBillingOrderLines.organizationId,
    locationId: commercialBillingOrderLines.locationId,
    locationName: locations.name,
    productId: commercialBillingOrderLines.productId,
    productName: commercialProducts.name,
    providerCode: commercialBillingOrderLines.providerCode,
    currency: commercialBillingOrderLines.currency,
    marketCode: commercialBillingOrderLines.marketCode,
    durationMonths: commercialBillingOrderLines.durationMonths,
    listAmountMinor: commercialBillingOrderLines.listAmountMinor,
    discountAmountMinor: commercialBillingOrderLines.discountAmountMinor,
    amountMinor: commercialBillingOrderLines.amountMinor,
    billingPeriodStartsAt: commercialBillingOrderLines.billingPeriodStartsAt,
    billingPeriodEndsAt: commercialBillingOrderLines.billingPeriodEndsAt,
  }).from(commercialBillingOrderLines)
    .innerJoin(locations, eq(locations.id, commercialBillingOrderLines.locationId))
    .innerJoin(commercialProducts, eq(commercialProducts.id, commercialBillingOrderLines.productId))
    .where(eq(commercialBillingOrderLines.orderId, orderId))
    .orderBy(asc(locations.name), asc(commercialBillingOrderLines.id));
  if (lines.length === 0) throw new BillingOrderReadError("not_found");
  try {
    for (const line of lines) {
      const authority = await requireLocationBillingAuthority(tx, userId, line.locationId);
      if (authority.organizationId !== order.organizationId || line.organizationId !== order.organizationId) {
        throw new BillingOrderReadError("not_found");
      }
    }
  } catch (error) {
    if (error instanceof BillingOrderReadError) throw error;
    if (error instanceof LocationBillingAuthorizationError) throw new BillingOrderReadError("not_found");
    throw error;
  }
  const [payment] = await tx.select({
    id: commercialPayments.id,
    status: commercialPayments.status,
    amountMinor: commercialPayments.amountMinor,
    currency: commercialPayments.currency,
    createdAt: commercialPayments.createdAt,
    updatedAt: commercialPayments.updatedAt,
    providerOccurredAt: commercialPayments.providerOccurredAt,
  }).from(commercialPayments).where(eq(commercialPayments.billingOrderId, order.id)).limit(1);
  return { order, lines, payment: payment ?? null };
}

function serializeOrder(record: Awaited<ReturnType<typeof requireVisibleOrder>>, now: Date) {
  const { order, lines, payment } = record;
  return {
    id: order.id,
    organizationId: order.organizationId,
    organizationName: order.organizationName,
    status: resolveBillingOrderState({ orderStatus: order.status, expiresAt: order.expiresAt, paymentStatus: payment?.status ?? null }, now),
    currency: order.currency,
    totalAmountMinor: order.totalAmountMinor.toString(),
    createdAt: order.createdAt.toISOString(),
    quotedAt: order.quotedAt?.toISOString() ?? null,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    updatedAt: order.updatedAt.toISOString(),
    payment: payment ? {
      status: payment.status,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      providerOccurredAt: payment.providerOccurredAt?.toISOString() ?? null,
    } : null,
    lines: lines.map((line) => ({
      id: line.id, locationId: line.locationId, locationName: line.locationName,
      productId: line.productId, productName: line.productName, durationMonths: line.durationMonths,
      providerCode: line.providerCode, marketCode: line.marketCode, currency: line.currency,
      listAmountMinor: line.listAmountMinor.toString(), discountAmountMinor: line.discountAmountMinor.toString(),
      amountMinor: line.amountMinor.toString(),
      billingPeriodStartsAt: line.billingPeriodStartsAt?.toISOString() ?? null,
      billingPeriodEndsAt: line.billingPeriodEndsAt?.toISOString() ?? null,
    })),
  };
}

/** Lists only orders whose every Location remains in the caller's billing scope. */
export async function listCustomerBillingOrders(input: {
  authenticatedUserId: string; limit?: number; cursor?: string;
}, now = new Date(), db: ReadDb = v2Db) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BillingOrderReadError("invalid_cursor");
  const cursor = decodeCursor(input.cursor);
  return db.transaction(async (tx) => {
    const memberships = await tx.selectDistinct({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(
        eq(organizationMembers.userId, input.authenticatedUserId),
        isNotNull(users.emailVerifiedAt), isNull(users.disabledAt), isNull(organizations.archivedAt),
      ));
    const organizationIds = memberships.map((row) => row.organizationId);
    if (organizationIds.length === 0) return { items: [], nextCursor: null };

    const items: Array<ReturnType<typeof serializeOrder>> = [];
    let scanCursor = cursor;
    let hasMoreCandidates = true;
    let scanned = 0;
    while (items.length <= limit && hasMoreCandidates && scanned < 500) {
      const conditions = [inArray(commercialBillingOrders.organizationId, organizationIds)];
      if (scanCursor) conditions.push(or(
        lt(commercialBillingOrders.createdAt, scanCursor.createdAt),
        and(eq(commercialBillingOrders.createdAt, scanCursor.createdAt), lt(commercialBillingOrders.id, scanCursor.id)),
      )!);
      const batch = await tx.select({ id: commercialBillingOrders.id, createdAt: commercialBillingOrders.createdAt })
        .from(commercialBillingOrders).where(and(...conditions))
        .orderBy(desc(commercialBillingOrders.createdAt), desc(commercialBillingOrders.id)).limit(50);
      hasMoreCandidates = batch.length === 50;
      if (batch.length === 0) break;
      for (const candidate of batch) {
        scanned += 1;
        scanCursor = { createdAt: candidate.createdAt, id: candidate.id };
        try {
          const record = await requireVisibleOrder(tx, input.authenticatedUserId, candidate.id);
          items.push(serializeOrder(record, now));
          if (items.length > limit) break;
        } catch (error) {
          if (!(error instanceof BillingOrderReadError)) throw error;
        }
      }
      if (items.length > limit) break;
    }
    const hasMoreVisible = items.length > limit;
    const visibleItems = items.slice(0, limit);
    return {
      items: visibleItems,
      nextCursor: hasMoreVisible && visibleItems.length
        ? encodeCursor({ createdAt: new Date(visibleItems[visibleItems.length - 1].createdAt), id: visibleItems[visibleItems.length - 1].id })
        : hasMoreCandidates && scanCursor ? encodeCursor(scanCursor) : null,
    };
  });
}

/** Reads trusted order/payment state without transitioning expired rows. */
export async function getCustomerBillingOrder(input: { authenticatedUserId: string; billingOrderId: string }, now = new Date(), db: ReadDb = v2Db) {
  return db.transaction(async (tx) =>
    serializeOrder(await requireVisibleOrder(tx, input.authenticatedUserId, input.billingOrderId), now));
}
