export type BillingEntitlement = {
  trial?: { status: string; startsAt: Date | string; endsAt: Date | string } | null;
  subscription?: { status: string; startsAt: Date | string; currentPeriodEndsAt: Date | string | null; canceledAt?: Date | string | null } | null;
  partnerBenefit?: { startsAt: Date | string; endsAt: Date | string | null } | null;
};

function date(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

export type CustomerBillingStatus = "trial" | "subscription" | "partner" | "expired" | "available";

/** Mirrors commercial access windows for customer-facing status only. */
export function resolveCustomerBillingStatus(entitlement: BillingEntitlement, now: Date): CustomerBillingStatus {
  const nowMs = now.getTime();
  const subscription = entitlement.subscription;
  if (subscription && (subscription.status === "active" || subscription.status === "canceled") &&
      (date(subscription.startsAt) ?? Infinity) <= nowMs &&
      (subscription.currentPeriodEndsAt == null || (date(subscription.currentPeriodEndsAt) ?? -Infinity) > nowMs)) return "subscription";
  const trial = entitlement.trial;
  if (trial?.status === "active" && (date(trial.startsAt) ?? Infinity) <= nowMs && (date(trial.endsAt) ?? -Infinity) > nowMs) return "trial";
  const benefit = entitlement.partnerBenefit;
  if (benefit && (date(benefit.startsAt) ?? Infinity) <= nowMs &&
      (benefit.endsAt == null || (date(benefit.endsAt) ?? -Infinity) > nowMs)) return "partner";
  return trial || subscription || benefit ? "expired" : "available";
}

export function normalizeMarketCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}
