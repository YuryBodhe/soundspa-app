import { and, asc, desc, eq } from "drizzle-orm";
import { FAKE_PROVIDER_CODE, fakeProviderIsConfigured, type FakeProviderEnvironment } from "@/lib/v2/fakePaymentProvider";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import { v2Db } from "../client";
import { commercialPaymentProviders, commercialPaymentRoutes, commercialPaymentRouteEvents, commercialProducts, type CommercialPaymentRouteAuditState } from "../schema";
import {
  PaymentRouteAdminError,
  requirePaymentRouteConfirmation,
  validatePaymentRouteChange,
  validatePaymentRouteConfiguration,
  validatePaymentRouteId,
  validatePaymentRouteProductId,
  validatePaymentRouteReason,
} from "./paymentRouteAdminValidation";

export { PAYMENT_ROUTE_PROVIDERS, PaymentRouteAdminError } from "./paymentRouteAdminValidation";
export type { PaymentRouteAdminErrorCode, PaymentRouteState, PaymentRouteAction } from "./paymentRouteAdminValidation";

type RouteTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: RouteTx) => Promise<T>) => Promise<T>;
const defaultTransaction: TransactionRunner = (operation) => v2Db.transaction(operation);

function requireOperator(authorization: unknown): string {
  if (typeof authorization !== "string" || operatorAuthStatus(authorization) !== 200) {
    throw new PaymentRouteAdminError("NOT_AUTHORIZED");
  }
  const operator = process.env.V2_ADMIN_USERNAME?.trim();
  if (!operator || operator.length > 160) throw new PaymentRouteAdminError("NOT_AUTHORIZED");
  return operator;
}

function postgresCode(error: unknown): string | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

function stateOf(route: CommercialPaymentRouteAuditState): CommercialPaymentRouteAuditState {
  return {
    marketCode: route.marketCode,
    providerCode: route.providerCode,
    externalReference: route.externalReference,
    isEnabled: route.isEnabled,
    displayOrder: route.displayOrder,
  };
}

async function readRoutes(db: Pick<typeof v2Db, "select">, productId: string) {
  const [product] = await db.select({ id: commercialProducts.id }).from(commercialProducts)
    .where(eq(commercialProducts.id, productId)).limit(1);
  if (!product) throw new PaymentRouteAdminError("PRODUCT_NOT_FOUND");
  const routes = await db.select({
    id: commercialPaymentRoutes.id,
    productId: commercialPaymentRoutes.productId,
    marketCode: commercialPaymentRoutes.marketCode,
    providerCode: commercialPaymentProviders.code,
    providerName: commercialPaymentProviders.displayName,
    providerEnabled: commercialPaymentProviders.isEnabled,
    externalReference: commercialPaymentRoutes.externalReference,
    isEnabled: commercialPaymentRoutes.isEnabled,
    displayOrder: commercialPaymentRoutes.displayOrder,
    createdAt: commercialPaymentRoutes.createdAt,
    updatedAt: commercialPaymentRoutes.updatedAt,
  }).from(commercialPaymentRoutes)
    .innerJoin(commercialPaymentProviders, eq(commercialPaymentProviders.code, commercialPaymentRoutes.providerCode))
    .where(eq(commercialPaymentRoutes.productId, productId))
    .orderBy(asc(commercialPaymentRoutes.marketCode), asc(commercialPaymentRoutes.providerCode), asc(commercialPaymentRoutes.displayOrder), asc(commercialPaymentRoutes.externalReference), asc(commercialPaymentRoutes.id));
  // Fetch history per route (rather than join rows, which would duplicate route cards).
  const historyByRoute = new Map<string, Array<{
    id: string; routeId: string; action: string; operator: string; reason: string;
    beforeState: CommercialPaymentRouteAuditState | null; afterState: CommercialPaymentRouteAuditState; createdAt: Date;
  }>>();
  for (const route of routes) {
    const history = await db.select({
      id: commercialPaymentRouteEvents.id,
      routeId: commercialPaymentRouteEvents.routeId,
      action: commercialPaymentRouteEvents.action,
      operator: commercialPaymentRouteEvents.operator,
      reason: commercialPaymentRouteEvents.reason,
      beforeState: commercialPaymentRouteEvents.beforeState,
      afterState: commercialPaymentRouteEvents.afterState,
      createdAt: commercialPaymentRouteEvents.createdAt,
    }).from(commercialPaymentRouteEvents)
      .where(eq(commercialPaymentRouteEvents.routeId, route.id))
      .orderBy(desc(commercialPaymentRouteEvents.createdAt), desc(commercialPaymentRouteEvents.id));
    historyByRoute.set(route.id, history);
  }
  return { routes: routes.map((route) => ({ ...route, history: historyByRoute.get(route.id) ?? [] })) };
}

export async function listProductPaymentRoutes(input: { productId: unknown; operatorAuthorization: unknown }) {
  const productId = validatePaymentRouteProductId(input.productId);
  requireOperator(input.operatorAuthorization);
  return readRoutes(v2Db, productId);
}

export async function createProductPaymentRoute(input: {
  productId: unknown;
  marketCode: unknown;
  providerCode: unknown;
  externalReference: unknown;
  displayOrder: unknown;
  reason: unknown;
  operatorAuthorization: unknown;
}, runInTransaction: TransactionRunner = defaultTransaction) {
  const productId = validatePaymentRouteProductId(input.productId);
  const config = validatePaymentRouteConfiguration(input);
  const reason = validatePaymentRouteReason(input.reason);
  const operator = requireOperator(input.operatorAuthorization);
  try {
    return await runInTransaction(async (tx) => {
      const [product] = await tx.select({ id: commercialProducts.id }).from(commercialProducts)
        .where(eq(commercialProducts.id, productId)).for("update").limit(1);
      if (!product) throw new PaymentRouteAdminError("PRODUCT_NOT_FOUND");
      const [provider] = await tx.select({ code: commercialPaymentProviders.code })
        .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, config.providerCode)).for("share").limit(1);
      if (!provider) throw new PaymentRouteAdminError("PROVIDER_UNAVAILABLE");
      const [route] = await tx.insert(commercialPaymentRoutes).values({
        productId,
        ...config,
        isEnabled: false,
      }).returning();
      const afterState = stateOf(route);
      await tx.insert(commercialPaymentRouteEvents).values({
        routeId: route.id, action: "created", operator, reason, beforeState: null, afterState,
      });
      return { route, changed: true as const };
    });
  } catch (error) {
    if (postgresCode(error) === "23505") throw new PaymentRouteAdminError("ROUTE_IDENTITY_EXISTS");
    throw error;
  }
}

export async function updateProductPaymentRoute(input: {
  productId: unknown;
  routeId: unknown;
  isEnabled?: unknown;
  displayOrder?: unknown;
  reason: unknown;
  confirmed?: unknown;
  operatorAuthorization: unknown;
}, options: { runInTransaction?: TransactionRunner; env?: FakeProviderEnvironment } = {}) {
  const productId = validatePaymentRouteProductId(input.productId);
  const routeId = validatePaymentRouteId(input.routeId);
  const change = validatePaymentRouteChange(input);
  const reason = validatePaymentRouteReason(input.reason);
  const operator = requireOperator(input.operatorAuthorization);
  if (change.isEnabled === true) requirePaymentRouteConfirmation(input.confirmed);
  const runInTransaction = options.runInTransaction ?? defaultTransaction;
  const env = options.env ?? process.env;

  return runInTransaction(async (tx) => {
    const [route] = await tx.select().from(commercialPaymentRoutes).where(and(
      eq(commercialPaymentRoutes.id, routeId), eq(commercialPaymentRoutes.productId, productId),
    )).for("update").limit(1);
    if (!route) throw new PaymentRouteAdminError("ROUTE_NOT_FOUND");
    const beforeState = stateOf(route);
    if (change.isEnabled === true && !route.isEnabled) {
      const [provider] = await tx.select({ code: commercialPaymentProviders.code, isEnabled: commercialPaymentProviders.isEnabled })
        .from(commercialPaymentProviders).where(eq(commercialPaymentProviders.code, route.providerCode)).for("share").limit(1);
      if (!provider?.isEnabled) throw new PaymentRouteAdminError("PROVIDER_UNAVAILABLE");
      if (route.providerCode === FAKE_PROVIDER_CODE && !fakeProviderIsConfigured(env)) {
        throw new PaymentRouteAdminError("PROVIDER_UNAVAILABLE");
      }
    }
    const changed = change.isEnabled !== undefined ? change.isEnabled !== route.isEnabled : change.displayOrder !== route.displayOrder;
    if (!changed) return { route, changed: false as const };

    const [updated] = await tx.update(commercialPaymentRoutes).set({ ...change, updatedAt: new Date() })
      .where(and(eq(commercialPaymentRoutes.id, routeId), eq(commercialPaymentRoutes.productId, productId))).returning();
    const afterState = stateOf(updated);
    const action = change.isEnabled === true ? "enabled" : change.isEnabled === false ? "disabled" : "priority_changed";
    await tx.insert(commercialPaymentRouteEvents).values({ routeId, action, operator, reason, beforeState, afterState });
    return { route: updated, changed: true as const };
  });
}

export async function listProductPaymentRoutesForProductAdmin(db: Pick<typeof v2Db, "select">, productId: string) {
  return readRoutes(db, productId);
}
