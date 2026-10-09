import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { operatorAuthStatus } from "@/lib/v2/adminOperator";
import { v2Db } from "../client";
import {
  commercialBillingOrderLines,
  commercialBillingOrders,
  commercialBillingResets,
  commercialPaymentEvents,
  commercialPayments,
  commercialProducts,
  locationCoreTrials,
  locationServiceAccess,
  locationSubscriptions,
  locations,
  organizations,
} from "../schema";
import { billingResetEnvironmentAllowed, billingResetPlanHash, billingResetSafetyIssue, validateBillingResetInput, type BillingResetInput, type BillingResetPlan } from "./billingResetModel";

const FAKE_PROVIDER = "fake-staging";
type ResetDb = Pick<typeof v2Db, "select" | "insert" | "update" | "transaction" | "execute">;
type ResetTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export class BillingResetError extends Error {
  constructor(readonly code:
    | "not_authorized" | "not_staging" | "invalid_request" | "location_not_found" | "product_not_found"
    | "trial_product_invalid" | "unsafe_payment_state" | "active_aggregate_checkout_out_of_scope"
    | "active_legacy_access_out_of_scope" | "plan_changed" | "database_identity_mismatch") {
    super(code);
    this.name = "BillingResetError";
  }
}

async function assertStagingDatabase(db: ResetDb, env: NodeJS.ProcessEnv) {
  const identity = await db.execute(sql`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port`);
  const row = identity.rows[0] as { database?: string; role?: string; address?: string | null; port?: number } | undefined;
  const address = row?.address?.split("/")[0] ?? "";
  const octets = address.split(".").map(Number);
  const privateAddress = isIP(address) === 4 && octets.length === 4 && (
    octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
  const testLoopback = env.V2_BILLING_RESET_TEST_ALLOW_DATABASE === "1" &&
    new Set(["127.0.0.1", "::1"]).has(address) && row?.role === "soundspa_v2_test";
  if (row?.database !== "soundspa_v2" || row.port !== 5432 ||
      (row.role !== "soundspa_v2" && !testLoopback) || (!privateAddress && !testLoopback)) {
    throw new BillingResetError("database_identity_mismatch");
  }
}

function authorize(input: BillingResetInput & { operatorAuthorization: string }, db: ResetDb, env: NodeJS.ProcessEnv) {
  if (!billingResetEnvironmentAllowed(env) || db !== v2Db && env.V2_BILLING_RESET_TEST_ALLOW_DATABASE !== "1") {
    throw new BillingResetError("not_staging");
  }
  if (operatorAuthStatus(input.operatorAuthorization) !== 200) throw new BillingResetError("not_authorized");
  if (!env.V2_ADMIN_USERNAME?.trim()) throw new BillingResetError("not_authorized");
}

async function readPlan(tx: Pick<ResetTx, "select">, input: ReturnType<typeof validateBillingResetInput>, now: Date): Promise<BillingResetPlan> {
  const [locationRow] = await tx.select({
    id: locations.id, organizationId: locations.organizationId, locationName: locations.name,
    organizationName: organizations.name, organizationArchivedAt: organizations.archivedAt, archivedAt: locations.archivedAt,
  }).from(locations).innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(locations.id, input.locationId), eq(locations.organizationId, input.organizationId))).limit(1);
  if (!locationRow || locationRow.archivedAt || locationRow.organizationArchivedAt || !locationRow.organizationName) throw new BillingResetError("location_not_found");

  const products = await tx.select({ id: commercialProducts.id, code: commercialProducts.code, name: commercialProducts.name, kind: commercialProducts.kind })
    .from(commercialProducts).where(inArray(commercialProducts.id, input.productIds)).orderBy(asc(commercialProducts.id));
  if (products.length !== input.productIds.length) throw new BillingResetError("product_not_found");
  if (input.includeAllProducts) {
    const allProducts = await tx.select({ id: commercialProducts.id }).from(commercialProducts).orderBy(asc(commercialProducts.id));
    if (allProducts.length !== input.productIds.length || allProducts.some((product, index) => product.id !== input.productIds[index])) {
      throw new BillingResetError("invalid_request");
    }
  }
  const trialProduct = products.find((product) => product.id === input.trialProductId);
  if (!trialProduct || trialProduct.code !== "soundspa" || trialProduct.kind !== "core") throw new BillingResetError("trial_product_invalid");

  const subscriptions = await tx.select({ id: locationSubscriptions.id, productId: locationSubscriptions.productId, status: locationSubscriptions.status,
      startsAt: locationSubscriptions.startsAt, endsAt: locationSubscriptions.currentPeriodEndsAt,
      invalidatedByResetId: locationSubscriptions.invalidatedByResetId })
      .from(locationSubscriptions).where(and(eq(locationSubscriptions.locationId, input.locationId),
        inArray(locationSubscriptions.productId, input.productIds), isNull(locationSubscriptions.invalidatedByResetId))).orderBy(asc(locationSubscriptions.id));
  const trials = await tx.select({ id: locationCoreTrials.id, productId: locationCoreTrials.productId, status: locationCoreTrials.status,
      startsAt: locationCoreTrials.startsAt, endsAt: locationCoreTrials.endsAt,
      invalidatedByResetId: locationCoreTrials.invalidatedByResetId })
      .from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, input.locationId),
        inArray(locationCoreTrials.productId, input.productIds), isNull(locationCoreTrials.invalidatedByResetId))).orderBy(asc(locationCoreTrials.id));
  const matchingLines = await tx.select({ id: commercialBillingOrderLines.id, orderId: commercialBillingOrderLines.orderId, locationId: commercialBillingOrderLines.locationId,
      productId: commercialBillingOrderLines.productId })
      .from(commercialBillingOrderLines).where(and(eq(commercialBillingOrderLines.locationId, input.locationId),
        inArray(commercialBillingOrderLines.productId, input.productIds))).orderBy(asc(commercialBillingOrderLines.orderId), asc(commercialBillingOrderLines.id));
  const standalonePayments = await tx.select({ id: commercialPayments.id, status: commercialPayments.status, providerCode: commercialPayments.providerCode,
      productId: commercialPayments.productId, externalPaymentId: commercialPayments.externalPaymentId })
      .from(commercialPayments).where(and(eq(commercialPayments.locationId, input.locationId),
        inArray(commercialPayments.productId, input.productIds), isNull(commercialPayments.billingOrderId))).orderBy(asc(commercialPayments.id));
  const [legacyProjection] = await tx.select({ trialEndsAt: locationServiceAccess.trialEndsAt, paidThrough: locationServiceAccess.paidThrough })
    .from(locationServiceAccess).where(eq(locationServiceAccess.locationId, input.locationId)).limit(1);

  const orderIds = [...new Set(matchingLines.map((line) => line.orderId))].sort();
  const orders = [] as BillingResetPlan["orders"];
  for (const orderId of orderIds) {
    const [order] = await tx.select({ id: commercialBillingOrders.id, status: commercialBillingOrders.status })
      .from(commercialBillingOrders).where(eq(commercialBillingOrders.id, orderId)).limit(1);
    if (!order) throw new BillingResetError("unsafe_payment_state");
    const allLines = await tx.select({ id: commercialBillingOrderLines.id, locationId: commercialBillingOrderLines.locationId,
      productId: commercialBillingOrderLines.productId }).from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, orderId)).orderBy(asc(commercialBillingOrderLines.id));
    const [payment] = await tx.select({ id: commercialPayments.id, status: commercialPayments.status, providerCode: commercialPayments.providerCode })
      .from(commercialPayments).where(eq(commercialPayments.billingOrderId, orderId)).limit(1);
    orders.push({ id: order.id, status: order.status, paymentId: payment?.id ?? null, paymentStatus: payment?.status ?? null,
      providerCode: payment?.providerCode ?? null, lineIds: allLines.map((line) => line.id),
      allLinesInScope: allLines.length > 0 && allLines.every((line) => line.locationId === input.locationId && input.productIds.includes(line.productId)) });
  }
  return {
    organizationId: locationRow.organizationId, organizationName: locationRow.organizationName,
    locationId: locationRow.id, locationName: locationRow.locationName,
    products: products.map(({ id, code, name }) => ({ id, code, name })),
    subscriptions: subscriptions.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt?.toISOString() ?? null })),
    trials: trials.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
    orders, standalonePayments: standalonePayments.map((row) => ({ ...row, productId: row.productId! })),
    legacyLocationAccess: legacyProjection ? {
      trialEndsAt: legacyProjection.trialEndsAt?.toISOString() ?? null,
      paidThrough: legacyProjection.paidThrough?.toISOString() ?? null,
      activeAtPreview: Boolean((legacyProjection.trialEndsAt && legacyProjection.trialEndsAt > now) ||
        (legacyProjection.paidThrough && legacyProjection.paidThrough > now)),
    } : null,
  };
}

function translateSafetyIssue(issue: string): never {
  if (issue === "aggregate_order_out_of_scope") throw new BillingResetError("active_aggregate_checkout_out_of_scope");
  if (issue === "legacy_location_access_out_of_scope") throw new BillingResetError("active_legacy_access_out_of_scope");
  throw new BillingResetError("unsafe_payment_state");
}

function outputPlan(input: BillingResetInput, plan: BillingResetPlan, planHash: string) {
  const needsCancelOrders = plan.orders.filter((order) => ["draft", "quoted", "pending"].includes(order.status));
  const pendingOrderPaymentIds = new Set(plan.orders.filter((order) => order.paymentStatus === "pending").map((order) => order.paymentId));
  const pendingSinglePayments = plan.standalonePayments.filter((payment) => payment.status === "pending");
  return {
    mode: "dry-run",
    organization: { id: plan.organizationId, name: plan.organizationName },
    location: { id: plan.locationId, name: plan.locationName },
    products: plan.products,
    trial: { productId: input.trialProductId, durationDays: input.trialDurationDays, start: "apply-time" },
    changes: {
      historicalSubscriptionsToInvalidate: plan.subscriptions.map((row) => row.id),
      historicalTrialsToInvalidate: plan.trials.map((row) => row.id),
      ordersToClose: needsCancelOrders.map((row) => row.id),
      pendingFakePaymentsToClose: [...new Set([...pendingOrderPaymentIds, ...pendingSinglePayments.map((row) => row.id)])],
      successfulPaymentsPreserved: [
        ...plan.orders.filter((row) => row.paymentStatus === "succeeded").map((row) => row.paymentId!),
        ...plan.standalonePayments.filter((row) => row.status === "succeeded").map((row) => row.id),
      ],
      legacyLocationAccessToClear: input.includeAllProducts && plan.legacyLocationAccess &&
        (plan.legacyLocationAccess.trialEndsAt || plan.legacyLocationAccess.paidThrough)
        ? { trialEndsAt: plan.legacyLocationAccess.trialEndsAt, paidThrough: plan.legacyLocationAccess.paidThrough }
        : null,
      partnerBenefitsGiftAccessAndAdminGrants: "unchanged",
    },
    planHash,
  };
}

export async function previewStagingBillingReset(input: BillingResetInput & { operatorAuthorization: string }, now = new Date(), db: ResetDb = v2Db, env: NodeJS.ProcessEnv = process.env) {
  authorize(input, db, env);
  if (!Number.isFinite(now.getTime())) throw new BillingResetError("invalid_request");
  let normalized: ReturnType<typeof validateBillingResetInput>;
  try { normalized = validateBillingResetInput(input); } catch { throw new BillingResetError("invalid_request"); }
  await assertStagingDatabase(db, env);
  const plan = await db.transaction(async (tx) => readPlan(tx, normalized, now));
  const issue = billingResetSafetyIssue(plan, normalized.productIds, { includeAllProducts: normalized.includeAllProducts });
  if (issue) translateSafetyIssue(issue);
  const planHash = billingResetPlanHash(normalized, plan);
  return outputPlan(normalized, plan, planHash);
}

export async function applyStagingBillingReset(input: BillingResetInput & {
  operatorAuthorization: string; confirmationPhrase: string; expectedPlanHash: string;
}, now = new Date(), db: ResetDb = v2Db, env: NodeJS.ProcessEnv = process.env) {
  authorize(input, db, env);
  let normalized: ReturnType<typeof validateBillingResetInput>;
  try { normalized = validateBillingResetInput(input); } catch { throw new BillingResetError("invalid_request"); }
  const expectedPhrase = `RESET V2 STAGING BILLING ${normalized.organizationId} ${normalized.locationId}`;
  if (input.confirmationPhrase !== expectedPhrase || !/^[0-9a-f]{64}$/.test(input.expectedPlanHash) || !Number.isFinite(now.getTime())) {
    throw new BillingResetError("invalid_request");
  }
  await assertStagingDatabase(db, env);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Match checkout and settlement lock order: orders, payments, then Location.
    const beforeLockPlan = await readPlan(tx, normalized, now);
    const beforeHash = billingResetPlanHash(normalized, beforeLockPlan);
    if (beforeHash !== input.expectedPlanHash) throw new BillingResetError("plan_changed");
    const orderIds = beforeLockPlan.orders.map((order) => order.id).sort();
    if (orderIds.length) await tx.select({ id: commercialBillingOrders.id }).from(commercialBillingOrders)
      .where(inArray(commercialBillingOrders.id, orderIds)).orderBy(asc(commercialBillingOrders.id)).for("update");
    const paymentIds = [...new Set([
      ...beforeLockPlan.orders.flatMap((order) => order.paymentId ? [order.paymentId] : []),
      ...beforeLockPlan.standalonePayments.map((payment) => payment.id),
    ])].sort();
    if (paymentIds.length) await tx.select({ id: commercialPayments.id }).from(commercialPayments)
      .where(inArray(commercialPayments.id, paymentIds)).orderBy(asc(commercialPayments.id)).for("update");
    const [lockedLocation] = await tx.select({ id: locations.id, organizationId: locations.organizationId, archivedAt: locations.archivedAt })
      .from(locations).where(and(eq(locations.id, normalized.locationId), eq(locations.organizationId, normalized.organizationId))).for("update").limit(1);
    if (!lockedLocation || lockedLocation.archivedAt) throw new BillingResetError("location_not_found");
    if (normalized.includeAllProducts) {
      // The legacy projection is Location-wide and has no Product key. Lock it
      // alongside the Location so its previewed values cannot change mid-reset.
      await tx.select({ locationId: locationServiceAccess.locationId }).from(locationServiceAccess)
        .where(eq(locationServiceAccess.locationId, normalized.locationId)).for("update").limit(1);
    }

    // Checkout creation can have started before the Location lock. Re-read
    // under that lock and abort if its new row was not in the preview snapshot.
    const plan = await readPlan(tx, normalized, now);
    const planHash = billingResetPlanHash(normalized, plan);
    if (planHash !== input.expectedPlanHash) throw new BillingResetError("plan_changed");
    const issue = billingResetSafetyIssue(plan, normalized.productIds, { includeAllProducts: normalized.includeAllProducts });
    if (issue) translateSafetyIssue(issue);

    const resetId = randomUUID();
    const operator = process.env.V2_ADMIN_USERNAME!.trim();
    const affectedRecords = {
      subscriptions: plan.subscriptions.map((row) => row.id),
      trials: plan.trials.map((row) => row.id),
      ordersCanceled: plan.orders.filter((order) => ["draft", "quoted", "pending"].includes(order.status)).map((order) => order.id),
      paymentsCanceled: [
        ...plan.orders.filter((order) => order.paymentStatus === "pending").map((order) => order.paymentId!),
        ...plan.standalonePayments.filter((payment) => payment.status === "pending").map((payment) => payment.id),
      ],
      legacyLocationAccess: normalized.includeAllProducts && plan.legacyLocationAccess &&
        (plan.legacyLocationAccess.trialEndsAt || plan.legacyLocationAccess.paidThrough)
        ? { trialEndsAt: plan.legacyLocationAccess.trialEndsAt, paidThrough: plan.legacyLocationAccess.paidThrough }
        : null,
    };
    await tx.insert(commercialBillingResets).values({
      id: resetId, organizationId: normalized.organizationId, locationId: normalized.locationId,
      productIds: normalized.productIds, operator, reason: normalized.reason,
      trialDurationDays: normalized.trialDurationDays, affectedRecords, createdAt: now,
    });
    if (affectedRecords.subscriptions.length) await tx.update(locationSubscriptions)
      .set({ invalidatedByResetId: resetId, updatedAt: now })
      .where(and(inArray(locationSubscriptions.id, affectedRecords.subscriptions), isNull(locationSubscriptions.invalidatedByResetId)));
    if (affectedRecords.trials.length) await tx.update(locationCoreTrials)
      .set({ invalidatedByResetId: resetId, updatedAt: now })
      .where(and(inArray(locationCoreTrials.id, affectedRecords.trials), isNull(locationCoreTrials.invalidatedByResetId)));
    for (const paymentId of affectedRecords.paymentsCanceled) {
      const [payment] = await tx.select({ id: commercialPayments.id, providerCode: commercialPayments.providerCode,
        paymentKey: commercialPayments.paymentKey, status: commercialPayments.status })
        .from(commercialPayments).where(eq(commercialPayments.id, paymentId)).limit(1);
      if (!payment || payment.providerCode !== FAKE_PROVIDER || payment.status !== "pending") throw new BillingResetError("unsafe_payment_state");
      const eventIdentity = `billing-reset:${resetId}:payment:${payment.id}`;
      await tx.insert(commercialPaymentEvents).values({
        providerCode: payment.providerCode, paymentId: payment.id, externalEventId: eventIdentity,
        paymentKey: payment.paymentKey, idempotencyKey: eventIdentity, status: "canceled", occurredAt: now,
      });
      await tx.update(commercialPayments).set({ status: "canceled", updatedAt: now })
        .where(and(eq(commercialPayments.id, payment.id), eq(commercialPayments.status, "pending")));
    }
    for (const orderId of affectedRecords.ordersCanceled) {
      const order = plan.orders.find((row) => row.id === orderId)!;
      if (!["draft", "quoted", "pending"].includes(order.status)) throw new BillingResetError("unsafe_payment_state");
      await tx.update(commercialBillingOrders).set({ status: "canceled", updatedAt: now })
        .where(and(eq(commercialBillingOrders.id, orderId), inArray(commercialBillingOrders.status, ["draft", "quoted", "pending"])));
    }
    if (affectedRecords.legacyLocationAccess) {
      await tx.update(locationServiceAccess).set({ trialEndsAt: null, paidThrough: null, updatedAt: now })
        .where(eq(locationServiceAccess.locationId, normalized.locationId));
    }
    const trialStartsAt = now;
    const trialEndsAt = new Date(now.getTime() + normalized.trialDurationDays * 86_400_000);
    if (!Number.isFinite(trialEndsAt.getTime())) throw new BillingResetError("invalid_request");
    const [trial] = await tx.insert(locationCoreTrials).values({
      locationId: normalized.locationId, productId: normalized.trialProductId,
      status: "active", startsAt: trialStartsAt, endsAt: trialEndsAt, createdAt: now, updatedAt: now,
    }).returning({ id: locationCoreTrials.id });
    if (!trial) throw new BillingResetError("unsafe_payment_state");
    return {
      mode: "applied", resetId, operator, organizationId: normalized.organizationId, locationId: normalized.locationId,
      productIds: normalized.productIds, trial: { id: trial.id, startsAt: trialStartsAt.toISOString(), endsAt: trialEndsAt.toISOString() },
      affectedRecords,
    };
  });
}
