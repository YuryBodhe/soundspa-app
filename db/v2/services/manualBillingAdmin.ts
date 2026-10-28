import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { operatorAuthStatus } from "@/lib/v2/adminOperator";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines, commercialBillingOrders, commercialPaymentEvents,
  commercialPayments, commercialProducts, locationSubscriptions, locations, organizations,
} from "../schema";
import { MANUAL_BANK_TRANSFER_PROVIDER_CODE } from "./manualBillingModel";
import { settleTrustedBillingOrderPayment } from "./paymentLifecycle";
import { getOrganizationProductPurchaseEligibility } from "./productPurchaseAuthorization";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ManualBillingAdminError extends Error {
  constructor(readonly code: "not_authorized" | "invalid_input" | "not_found" | "payment_conflict" | "bank_reference_conflict") {
    super(code); this.name = "ManualBillingAdminError";
  }
}

function requireOperator(authorization: unknown): string {
  const operator = process.env.V2_ADMIN_USERNAME?.trim();
  if (typeof authorization !== "string" || operatorAuthStatus(authorization) !== 200 || !operator || operator.length > 200) {
    throw new ManualBillingAdminError("not_authorized");
  }
  return operator;
}

function postgresErrorCode(error: unknown): string | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const row = current as { code?: unknown; cause?: unknown };
    if (typeof row.code === "string") return row.code;
    current = row.cause;
  }
  return undefined;
}

type BillingReadDb = Pick<typeof v2Db, "select">;

export async function listManualBillingAdminData(authorization: unknown, db: BillingReadDb = v2Db, now = new Date()) {
  requireOperator(authorization);
  const [organizationRows, productRows, orderRows] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name, locationId: locations.id, locationName: locations.name })
      .from(organizations).leftJoin(locations, and(eq(locations.organizationId, organizations.id), isNull(locations.archivedAt)))
      .where(isNull(organizations.archivedAt)).orderBy(asc(organizations.name), asc(locations.name)),
    db.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name })
      .from(commercialProducts).where(eq(commercialProducts.isActive, true)).orderBy(asc(commercialProducts.name), asc(commercialProducts.id)),
    db.select({ id: commercialBillingOrders.id, organizationId: commercialBillingOrders.organizationId,
      organizationName: organizations.name, status: commercialBillingOrders.status, providerCode: commercialBillingOrders.providerCode,
      currency: commercialBillingOrders.currency, totalAmountMinor: commercialBillingOrders.totalAmountMinor,
      invoiceNumber: commercialBillingOrders.externalInvoiceNumber, invoiceIssuedAt: commercialBillingOrders.invoiceIssuedAt,
      paymentDueAt: commercialBillingOrders.paymentDueAt, createdAt: commercialBillingOrders.createdAt,
      createdByOperator: commercialBillingOrders.createdByOperator, creationReason: commercialBillingOrders.creationReason,
      paymentId: commercialPayments.id, paymentStatus: commercialPayments.status, paymentAmountMinor: commercialPayments.amountMinor,
      paymentCurrency: commercialPayments.currency, bankTransactionReference: commercialPayments.bankTransactionReference,
      paidAt: commercialPayments.providerOccurredAt,
    }).from(commercialBillingOrders).innerJoin(organizations, eq(organizations.id, commercialBillingOrders.organizationId))
      .leftJoin(commercialPayments, eq(commercialPayments.billingOrderId, commercialBillingOrders.id))
      .where(eq(commercialBillingOrders.providerCode, MANUAL_BANK_TRANSFER_PROVIDER_CODE))
      .orderBy(desc(commercialBillingOrders.createdAt), desc(commercialBillingOrders.id)).limit(500),
  ]);
  const organizationsList = new Map<string, { id: string; name: string; locations: Array<{ id: string; name: string }> }>();
  for (const row of organizationRows) {
    const organization = organizationsList.get(row.id) ?? { id: row.id, name: row.name, locations: [] };
    if (row.locationId) organization.locations.push({ id: row.locationId, name: row.locationName! });
    organizationsList.set(row.id, organization);
  }
  const orderIds = orderRows.map((row) => row.id);
  const paymentIds = orderRows.flatMap((row) => row.paymentId ? [row.paymentId] : []);
  const [lineRows, eventRows] = orderIds.length ? await Promise.all([
    db.select({ orderId: commercialBillingOrderLines.orderId, locationId: commercialBillingOrderLines.locationId, locationName: locations.name,
      productId: commercialBillingOrderLines.productId, productName: commercialProducts.name,
      amountMinor: commercialBillingOrderLines.amountMinor, currency: commercialBillingOrderLines.currency,
      startsAt: commercialBillingOrderLines.billingPeriodStartsAt, endsAt: commercialBillingOrderLines.billingPeriodEndsAt,
    }).from(commercialBillingOrderLines).innerJoin(locations, eq(locations.id, commercialBillingOrderLines.locationId))
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialBillingOrderLines.productId))
      .where(inArray(commercialBillingOrderLines.orderId, orderIds)).orderBy(asc(locations.name), asc(commercialBillingOrderLines.id)),
    paymentIds.length ? db.select({ paymentId: commercialPaymentEvents.paymentId, id: commercialPaymentEvents.id, occurredAt: commercialPaymentEvents.occurredAt,
      operator: commercialPaymentEvents.confirmedByOperator, reason: commercialPaymentEvents.confirmationReason,
      status: commercialPaymentEvents.status,
    }).from(commercialPaymentEvents).where(and(inArray(commercialPaymentEvents.paymentId, paymentIds), isNotNull(commercialPaymentEvents.confirmedByOperator)))
      .orderBy(desc(commercialPaymentEvents.createdAt), desc(commercialPaymentEvents.id)) : Promise.resolve([]),
  ]) : [[], []];
  const linesByOrder = new Map<string, typeof lineRows>();
  for (const line of lineRows) linesByOrder.set(line.orderId, [...(linesByOrder.get(line.orderId) ?? []), line]);
  const eventsByPayment = new Map<string, typeof eventRows>();
  for (const event of eventRows) if (event.paymentId) eventsByPayment.set(event.paymentId, [...(eventsByPayment.get(event.paymentId) ?? []), event]);
  const orders = orderRows.map((row) => {
    const lines = linesByOrder.get(row.id) ?? [];
    const events = row.paymentId ? eventsByPayment.get(row.paymentId) ?? [] : [];
    const overdue = row.status === "pending" && row.paymentStatus === "pending" && row.paymentDueAt !== null &&
      row.paymentDueAt.getTime() + 86_400_000 <= now.getTime();
    return { ...row, status: row.status === "canceled" ? "cancelled" : overdue ? "overdue" : row.status,
      totalAmountMinor: row.totalAmountMinor.toString(), paymentAmountMinor: row.paymentAmountMinor?.toString() ?? null,
      invoiceIssuedAt: row.invoiceIssuedAt?.toISOString() ?? null, paymentDueAt: row.paymentDueAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null,
      lines: lines.map((line) => ({ ...line, amountMinor: line.amountMinor.toString(), startsAt: line.startsAt?.toISOString() ?? null, endsAt: line.endsAt?.toISOString() ?? null })),
      events: events.map((event) => ({ ...event, occurredAt: event.occurredAt?.toISOString() ?? null })),
    };
  });
  const eligibleOrganizations = await Promise.all([...organizationsList.values()].map(async (organization) => {
    const eligibility = await getOrganizationProductPurchaseEligibility(db, organization.id, productRows.map((product) => product.id));
    return { ...organization, products: productRows.filter((product) => eligibility.get(product.id)?.eligible) };
  }));
  return { organizations: eligibleOrganizations, products: productRows, orders };
}

export async function listManualSubscriptionOverview(authorization: unknown, db: BillingReadDb = v2Db, now = new Date()) {
  requireOperator(authorization);
  const rows = await db.select({ id: locationSubscriptions.id, organizationId: organizations.id, organizationName: organizations.name,
    locationName: locations.name, productName: commercialProducts.name, startsAt: locationSubscriptions.startsAt,
    paidThroughAt: locationSubscriptions.currentPeriodEndsAt, status: locationSubscriptions.status,
    canceledAt: locationSubscriptions.canceledAt,
  }).from(locationSubscriptions).innerJoin(locations, eq(locations.id, locationSubscriptions.locationId))
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .innerJoin(commercialProducts, eq(commercialProducts.id, locationSubscriptions.productId))
    .where(and(isNull(organizations.archivedAt), isNull(locationSubscriptions.invalidatedByResetId),
      inArray(locationSubscriptions.status, ["active", "canceled"]),
      or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now), gt(locationSubscriptions.startsAt, now))))
    .orderBy(asc(organizations.name), asc(locations.name), asc(commercialProducts.name));
  return rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), paidThroughAt: row.paidThroughAt?.toISOString() ?? null,
    status: row.startsAt > now ? "upcoming" : row.status === "canceled" ? "canceling" : "active", canceledAt: row.canceledAt?.toISOString() ?? null }));
}

export async function confirmManualBankTransferPayment(input: {
  orderId: unknown; operatorAuthorization: unknown; amountMinor: unknown; currency: unknown;
  bankTransactionReference: unknown; actualPaymentDate: unknown; reason: unknown;
}, options: { db?: Pick<typeof v2Db, "select" | "insert" | "update" | "transaction">; now?: Date } = {}) {
  const db = options.db ?? v2Db;
  const now = options.now ?? new Date();
  const operator = requireOperator(input.operatorAuthorization);
  const reference = typeof input.bankTransactionReference === "string" ? input.bankTransactionReference.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const occurredAt = typeof input.actualPaymentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.actualPaymentDate)
    ? new Date(`${input.actualPaymentDate}T12:00:00.000Z`) : new Date(NaN);
  if (typeof input.orderId !== "string" || !UUID.test(input.orderId) || typeof input.amountMinor !== "string" || !/^[1-9]\d{0,18}$/.test(input.amountMinor) ||
      typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency) || !reference || reference.length > 200 || /[\u0000-\u001f\u007f]/.test(reference) ||
      !reason || reason.length < 12 || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason) || !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.toISOString().slice(0, 10) !== input.actualPaymentDate || !Number.isFinite(now.getTime()) ||
      input.actualPaymentDate > now.toISOString().slice(0, 10)) throw new ManualBillingAdminError("invalid_input");
  const amountMinor = BigInt(input.amountMinor);
  const [record] = await db.select({ orderId: commercialBillingOrders.id, orderStatus: commercialBillingOrders.status,
    providerCode: commercialBillingOrders.providerCode, invoiceNumber: commercialBillingOrders.externalInvoiceNumber,
    invoiceIssuedAt: commercialBillingOrders.invoiceIssuedAt, paymentDueAt: commercialBillingOrders.paymentDueAt,
    orderAmount: commercialBillingOrders.totalAmountMinor, orderCurrency: commercialBillingOrders.currency,
    paymentId: commercialPayments.id, paymentKey: commercialPayments.paymentKey, paymentStatus: commercialPayments.status,
    paymentAmount: commercialPayments.amountMinor, paymentCurrency: commercialPayments.currency,
    paymentReference: commercialPayments.bankTransactionReference,
  }).from(commercialBillingOrders).innerJoin(commercialPayments, eq(commercialPayments.billingOrderId, commercialBillingOrders.id))
    .where(eq(commercialBillingOrders.id, input.orderId)).limit(1);
  if (!record) throw new ManualBillingAdminError("not_found");
  if (record.providerCode !== MANUAL_BANK_TRANSFER_PROVIDER_CODE || !record.invoiceNumber || !record.invoiceIssuedAt || !record.paymentDueAt ||
      record.orderStatus !== "pending" && record.orderStatus !== "paid" || record.paymentStatus !== "pending" && record.paymentStatus !== "succeeded" ||
      record.orderAmount !== amountMinor || record.paymentAmount !== amountMinor || record.orderCurrency !== input.currency || record.paymentCurrency !== input.currency ||
      (record.paymentReference !== null && record.paymentReference !== reference)) throw new ManualBillingAdminError("payment_conflict");
  const referenceHash = createHash("sha256").update(reference).digest("hex");
  try {
    const result = await settleTrustedBillingOrderPayment({
      orderId: record.orderId, paymentId: record.paymentId, providerCode: MANUAL_BANK_TRANSFER_PROVIDER_CODE,
      paymentKey: record.paymentKey, externalPaymentId: null, idempotencyKey: `manual-bank:${referenceHash}`,
      externalEventId: `manual-bank:${referenceHash}`, amountMinor, currency: input.currency, occurredAt,
      bankTransactionReference: reference, confirmedByOperator: operator, confirmationReason: reason,
    }, db);
    return result;
  } catch (error) {
    if (postgresErrorCode(error) === "23505" ||
        error instanceof Error && "code" in error && (error as { code: unknown }).code === "payment_event_identity_conflict") {
      throw new ManualBillingAdminError("bank_reference_conflict");
    }
    throw error;
  }
}
