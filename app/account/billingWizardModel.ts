export type BillingMarketSaveErrorCode =
  | "invalid"
  | "invalid_market"
  | "market_unavailable"
  | "not_authorized"
  | "unavailable"
  | "market_refresh_failed";

export type BillingMarketSelectionState = "saved" | "missing" | "unsaved" | "saving" | "error";

export type BillingSelectionLocation = {
  id: string;
  products: Array<{ productId: string; purchaseEligible: boolean }>;
};
export type BillingSelectionLine = { locationId: string; productId: string; durationMonths: number };

export function billingOrderRequestPayload(organizationId: string, lines: readonly BillingSelectionLine[]) {
  return { organizationId, lines: lines.map(({ locationId, productId, durationMonths }) => ({ locationId, productId, durationMonths })) };
}

export function billingLineKey(locationId: string, productId: string): string {
  return `${locationId}:${productId}`;
}

export function toggleBillingProductSelection(
  current: Record<string, string[]>, locationId: string, productId: string, checked: boolean,
): Record<string, string[]> {
  const selected = new Set(current[locationId] ?? []);
  if (checked) selected.add(productId);
  else selected.delete(productId);
  const next = { ...current };
  if (selected.size) next[locationId] = [...selected];
  else delete next[locationId];
  return next;
}

export function buildSelectedBillingLines(
  locations: readonly BillingSelectionLocation[],
  selectedByLocation: Record<string, string[]>,
  durations: Record<string, number>,
): BillingSelectionLine[] {
  const lines: BillingSelectionLine[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    const selectedIds = new Set(selectedByLocation[location.id] ?? []);
    for (const product of location.products) {
      const productId = product.productId;
      if (!selectedIds.has(productId) || !product.purchaseEligible) continue;
      const key = billingLineKey(location.id, productId);
      if (seen.has(key)) continue;
      seen.add(key);
      const months = durations[key] ?? 1;
      if (Number.isInteger(months) && months >= 1 && months <= 12) lines.push({ locationId: location.id, productId, durationMonths: months });
    }
  }
  return lines;
}

export function restoreBillingOrderSelection(
  lines: readonly Pick<BillingSelectionLine, "locationId" | "productId" | "durationMonths">[],
): { selectedByLocation: Record<string, string[]>; durations: Record<string, number> } {
  const selectedByLocation: Record<string, string[]> = {};
  const durations: Record<string, number> = {};
  for (const line of lines) {
    const key = billingLineKey(line.locationId, line.productId);
    const selected = selectedByLocation[line.locationId] ?? (selectedByLocation[line.locationId] = []);
    if (!selected.includes(line.productId)) selected.push(line.productId);
    durations[key] = line.durationMonths;
  }
  return { selectedByLocation, durations };
}

export function formatBillingPeriodRange(startsAt: string, endsAt: string, locale: string): string | null {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  return `${formatDate.format(start)} – ${formatDate.format(end)}`;
}

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
