export type AccountPlanStatus = "trial" | "subscription" | "partner" | "expired" | "available";

export type AccountPlanSnapshot = {
  productId: string;
  status: AccountPlanStatus;
  trialEndsAt: string | null;
  paidThrough: string | null;
  trialActive: boolean;
};

export type AccountPartnerBenefit = {
  productId: string;
  startsAt: string;
  endsAt: string | null;
};

export type AccountLocationPlan = AccountPlanSnapshot & { productName: string };

export function accountPlanPresentation(
  plan: AccountPlanSnapshot,
  partnerBenefits: readonly AccountPartnerBenefit[],
  now = Date.now(),
) {
  const benefit = partnerBenefits.find((item) => item.productId === plan.productId &&
    new Date(item.startsAt).getTime() <= now && (item.endsAt === null || new Date(item.endsAt).getTime() > now));
  const trialRemainingMs = plan.trialActive && plan.trialEndsAt ? new Date(plan.trialEndsAt).getTime() - now : null;
  const trialRemainingDays = trialRemainingMs === null ? null
    : trialRemainingMs < 24 * 60 * 60 * 1000 ? 0
      : Math.ceil(trialRemainingMs / (24 * 60 * 60 * 1000));
  const accessExpiresAt = plan.status === "trial" ? plan.trialEndsAt
    : plan.status === "subscription" ? plan.paidThrough
      : plan.status === "partner" ? benefit?.endsAt ?? null : null;
  return { trialRemainingDays, accessExpiresAt };
}

/** Summarize one Location without combining different Product periods into one date. */
export function accountLocationPresentation<T extends AccountLocationPlan>(
  plans: readonly T[],
  partnerBenefits: readonly AccountPartnerBenefit[],
  now = Date.now(),
) {
  const products = plans.map((plan) => ({
    ...plan,
    ...accountPlanPresentation(plan, partnerBenefits, now),
  }));
  const activeProducts = products.filter((product) =>
    product.status === "trial" || product.status === "subscription" || product.status === "partner",
  );
  const accessWindows = new Set(activeProducts.map((product) => product.accessExpiresAt ?? "indefinite"));
  const accessStates = new Set(activeProducts.map((product) => `${product.status}:${product.accessExpiresAt ?? "indefinite"}`));
  const oneSharedExpiry = accessWindows.size === 1 && activeProducts[0]?.accessExpiresAt !== null
    ? activeProducts[0]?.accessExpiresAt ?? null
    : null;
  return {
    products,
    activeProducts,
    activeProductCount: activeProducts.length,
    summaryKind: activeProducts.length === 0 ? "none" as const : activeProducts.length === 1 ? "single" as const : "multiple" as const,
    hasDifferentAccessExpirations: accessWindows.size > 1,
    hasDifferentAccessStates: accessStates.size > 1,
    accessExpiresAt: oneSharedExpiry,
    trialRemainingDays: activeProducts.length === 1 && activeProducts[0].trialActive
      ? activeProducts[0].trialRemainingDays
      : null,
  };
}

export function shouldRefreshAccountOnReturn(now: number, lastRefreshAt: number, visible: boolean, cooldownMs = 1200): boolean {
  return visible && now - lastRefreshAt >= cooldownMs;
}
