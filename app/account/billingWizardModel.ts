export type BillingMarketSaveErrorCode =
  | "invalid"
  | "invalid_market"
  | "market_unavailable"
  | "not_authorized"
  | "unavailable"
  | "market_refresh_failed";

export type BillingMarketSelectionState = "saved" | "missing" | "unsaved" | "saving" | "error";

export function canResumeBillingOrder(status: string): boolean { return status === "pending"; }

export function billingOrderStatusKey(status: string): string {
  const keys: Record<string, string> = {
    pending: "billingOrderPending", paid: "billingOrderPaid", expired: "billingOrderExpiredStatus",
    canceled: "billingOrderAbandoned", failed: "billingOrderFailed", draft: "billingOrderDraft", quoted: "billingOrderDraft",
  };
  return keys[status] ?? "billingOrderFailed";
}

export function billingMarketSelectionState(input: {
  persistedMarket: string | null;
  selectedMarket: string;
  saving: boolean;
  error: string;
}): BillingMarketSelectionState {
  if (input.saving) return "saving";
  if (input.error) return "error";
  if (input.persistedMarket && (!input.selectedMarket || input.selectedMarket === input.persistedMarket)) return "saved";
  return input.selectedMarket ? "unsaved" : "missing";
}

export function canPreviewBillingLines(lines: readonly { marketCode: string | null; selectedMarket?: string }[]): boolean {
  return lines.length > 0 && lines.every((line) => Boolean(line.marketCode) && (!line.selectedMarket || line.selectedMarket === line.marketCode));
}

export async function saveBillingMarketAndRefresh<T extends { id: string; marketCode: string | null }>(input: {
  locationId: string;
  marketCode: string;
  save: (locationId: string, marketCode: string) => Promise<void>;
  refresh: () => Promise<readonly T[]>;
}): Promise<T> {
  await input.save(input.locationId, input.marketCode);
  const locations = await input.refresh();
  const refreshed = locations.find((location) => location.id === input.locationId);
  if (!refreshed || refreshed.marketCode !== input.marketCode) throw new Error("market_refresh_failed");
  return refreshed;
}

export function billingOrderErrorKey(code: string, lineCount: number): string {
  if (["unauthenticated_or_unverified", "unauthenticated", "not_authorized"].includes(code)) return "billingUnauthorized";
  if (code === "market_not_configured") return "billingMarketMissing";
  if (code === "market_unavailable") return "billingMarketUnavailable";
  if (code === "route_unavailable" || code === "product_unavailable") {
    return lineCount > 1 ? "billingWizardMultiLocationRouteUnavailable" : "billingNoRoutes";
  }
  if (code === "incompatible_routes") return "billingWizardIncompatibleRoutes";
  if (code === "unsupported_pricing") {
    return lineCount > 1 ? "billingWizardMultiLocationPricingUnavailable" : "billingPaymentFailed";
  }
  if (code === "provider_not_configured") return "billingProviderUnavailable";
  if (code === "checkout_expired" || code === "expired") return "billingCheckoutExpired";
  if (["checkout_pending", "order_stale"].includes(code)) return "billingCheckoutPending";
  if (["invalid_request", "duplicate_line", "invalid"].includes(code)) return "billingWizardInvalidSelection";
  return "billingPaymentFailed";
}
