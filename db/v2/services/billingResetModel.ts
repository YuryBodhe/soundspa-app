import { createHash } from "node:crypto";

export type BillingResetInput = {
  organizationId: string;
  locationId: string;
  productIds: string[];
  trialProductId: string;
  trialDurationDays: number;
  reason: string;
  includeAllProducts?: boolean;
};

export type BillingResetPlan = {
  organizationId: string;
  organizationName: string;
  locationId: string;
  locationName: string;
  products: Array<{ id: string; code: string; name: string }>;
  subscriptions: Array<{ id: string; productId: string; status: string; startsAt: string; endsAt: string | null; invalidatedByResetId: string | null }>;
  trials: Array<{ id: string; productId: string; status: string; startsAt: string; endsAt: string; invalidatedByResetId: string | null }>;
  orders: Array<{ id: string; status: string; paymentId: string | null; paymentStatus: string | null; providerCode: string | null; lineIds: string[]; allLinesInScope: boolean }>;
  standalonePayments: Array<{ id: string; status: string; providerCode: string; productId: string; externalPaymentId: string | null }>;
  legacyLocationAccess: { trialEndsAt: string | null; paidThrough: string | null; activeAtPreview: boolean } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateBillingResetInput(input: BillingResetInput) {
  const reason = input.reason.trim();
  const productIds = [...new Set(input.productIds)].sort();
  if (!UUID.test(input.organizationId) || !UUID.test(input.locationId) || !UUID.test(input.trialProductId) ||
      productIds.length === 0 || productIds.some((id) => !UUID.test(id)) || !productIds.includes(input.trialProductId) ||
      !Number.isInteger(input.trialDurationDays) || input.trialDurationDays < 1 || input.trialDurationDays > 365 ||
      reason.length < 12 || reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason) ||
      (input.includeAllProducts !== undefined && typeof input.includeAllProducts !== "boolean")) {
    throw new Error("invalid_billing_reset_request");
  }
  return { ...input, productIds, reason, includeAllProducts: input.includeAllProducts ?? false };
}

export function billingResetPlanHash(input: BillingResetInput, plan: BillingResetPlan): string {
  const normalizedInput = validateBillingResetInput(input);
  const stable = {
    organizationId: plan.organizationId,
    locationId: plan.locationId,
    productIds: normalizedInput.productIds,
    trialProductId: normalizedInput.trialProductId,
    trialDurationDays: normalizedInput.trialDurationDays,
    includeAllProducts: normalizedInput.includeAllProducts ?? false,
    reason: normalizedInput.reason,
    subscriptions: [...plan.subscriptions].map((row) => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id)),
    trials: [...plan.trials].map((row) => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id)),
    orders: [...plan.orders].map((row) => ({ ...row, lineIds: [...row.lineIds].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    standalonePayments: [...plan.standalonePayments].map((row) => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id)),
    legacyLocationAccess: plan.legacyLocationAccess ? { ...plan.legacyLocationAccess } : null,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function billingResetEnvironmentAllowed(env: Record<string, string | undefined>): boolean {
  if (env.V2_DEPLOYMENT_ENV !== "staging" || env.V2_PUBLIC_ORIGIN !== "https://test.soundspa.bodhemusic.com" || !env.V2_DATABASE_URL) return false;
  try {
    const url = new URL(env.V2_DATABASE_URL);
    const host = url.hostname.toLowerCase();
    const testLoopback = env.V2_BILLING_RESET_TEST_ALLOW_DATABASE === "1" &&
      new Set(["localhost", "127.0.0.1", "::1"]).has(host) && decodeURIComponent(url.username) === "soundspa_v2_test";
    return ["postgres:", "postgresql:"].includes(url.protocol) && decodeURIComponent(url.pathname) === "/soundspa_v2" &&
      (!url.port || url.port === "5432") &&
      ((host === "v2-postgres" && decodeURIComponent(url.username) === "soundspa_v2") || testLoopback);
  } catch { return false; }
}

export function billingResetSafetyIssue(plan: BillingResetPlan, selectedProductIds: string[], options: { fakeProviderCode?: string; includeAllProducts?: boolean } = {}): string | null {
  const selected = new Set(selectedProductIds);
  const fakeProviderCode = options.fakeProviderCode ?? "fake-staging";
  if (plan.legacyLocationAccess?.activeAtPreview && !options.includeAllProducts) return "legacy_location_access_out_of_scope";
  for (const order of plan.orders) {
    if (!new Set(["draft", "quoted", "pending", "paid", "expired", "canceled", "failed"]).has(order.status)) return "unknown_payment_state";
    if (order.status === "paid" && !["succeeded", "refunded", "partially_refunded"].includes(order.paymentStatus ?? "")) return "order_payment_state_conflict";
    if (order.paymentStatus === "succeeded" && order.status !== "paid") return "order_payment_state_conflict";
    const needsClosure = ["draft", "quoted", "pending"].includes(order.status);
    if (order.paymentStatus === "pending" && !order.allLinesInScope) return "aggregate_order_out_of_scope";
    if (order.paymentStatus === "pending" && order.status === "failed") return "order_payment_state_conflict";
    if (order.paymentStatus === "pending" && order.providerCode !== fakeProviderCode) return "non_fake_pending_payment";
    if (order.paymentStatus === "pending" && !order.paymentId) return "unknown_payment_state";
    if (!needsClosure) continue;
    if (!order.allLinesInScope) return "aggregate_order_out_of_scope";
    if (["pending", "quoted"].includes(order.status) && !order.paymentId && order.status === "pending") return "pending_order_without_payment";
    if (order.paymentStatus === "succeeded" || order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded") return "order_payment_state_conflict";
    if (order.paymentId && order.paymentStatus !== "pending" && !["failed", "canceled"].includes(order.paymentStatus ?? "")) return "unknown_payment_state";
  }
  for (const payment of plan.standalonePayments) {
    if (!selected.has(payment.productId)) return "payment_out_of_scope";
    if (payment.status === "pending" && payment.providerCode !== fakeProviderCode) return "non_fake_pending_payment";
    if (!new Set(["pending", "succeeded", "failed", "canceled", "refunded", "partially_refunded"]).has(payment.status)) return "unknown_payment_state";
  }
  return null;
}
