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

export function shouldRefreshAccountOnReturn(now: number, lastRefreshAt: number, visible: boolean, cooldownMs = 1200): boolean {
  return visible && now - lastRefreshAt >= cooldownMs;
}
