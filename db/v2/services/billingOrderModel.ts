import { FAKE_PAYMENT_AMOUNT_MINOR, FAKE_PAYMENT_CURRENCY, FAKE_PROVIDER_CODE, FAKE_PROVIDER_MARKET, fakeProviderIsConfigured, type FakeProviderEnvironment } from "@/lib/v2/fakePaymentProvider";
import { createHash } from "node:crypto";

export type RequestedBillingOrderLine = {
  locationId: string;
  productId: string;
  durationMonths: number;
};

export type BillingRouteQuoteCandidate = {
  routeId: string;
  providerCode: string;
  currency: string;
  marketCode: string;
  externalReference: string;
  displayOrder: number;
  listAmountMinor: bigint;
  discountAmountMinor: bigint;
};

export type SelectedBillingRouteQuote = BillingRouteQuoteCandidate & {
  amountMinor: bigint;
};

export type BillingPricingInput = {
  providerCode: string;
  marketCode: string;
  durationMonths: number;
  env: FakeProviderEnvironment;
};

export type BillingPricingResult = {
  currency: string;
  listAmountMinor: bigint;
  discountAmountMinor: bigint;
};

export type BillingPricingAdapter = {
  providerCode: string;
  quote(input: BillingPricingInput): BillingPricingResult | null;
};

type BillingOrderSnapshotLine = {
  id: string;
  locationId: string;
  productId: string;
  providerCode: string;
  currency: string;
  marketCode: string;
  routeId: string;
  routeExternalReference: string;
  durationMonths: number;
  listAmountMinor: bigint;
  discountAmountMinor: bigint;
  amountMinor: bigint;
  billingAnchorDay: number;
  billingAnchorIsEndOfMonth: boolean;
  billingPeriodStartsAt: Date | null;
  billingPeriodEndsAt: Date | null;
  subscriptionId: string | null;
};

/** Stable integrity reference for the immutable Order/Line terms accepted at checkout. */
export function billingOrderSnapshotReference(order: {
  id: string;
  organizationId: string;
  providerCode: string;
  currency: string;
  totalAmountMinor: bigint;
}, lines: readonly BillingOrderSnapshotLine[]): string {
  const canonical = {
    order: [order.id, order.organizationId, order.providerCode, order.currency, order.totalAmountMinor.toString()],
    lines: [...lines].sort((left, right) => left.id.localeCompare(right.id)).map((line) => [
      line.id, line.locationId, line.productId, line.providerCode, line.currency, line.marketCode,
      line.routeId, line.routeExternalReference, line.durationMonths, line.listAmountMinor.toString(),
      line.discountAmountMinor.toString(), line.amountMinor.toString(), line.billingAnchorDay,
      line.billingAnchorIsEndOfMonth, line.billingPeriodStartsAt?.toISOString() ?? null,
      line.billingPeriodEndsAt?.toISOString() ?? null,
    ]),
  };
  return `snapshot-v1:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export class BillingOrderModelError extends Error {
  constructor(readonly code: "invalid_request" | "duplicate_line" | "unsupported_pricing" | "incompatible_routes") {
    super(code);
    this.name = "BillingOrderModelError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateBillingOrderRequest(value: unknown): { organizationId: string; lines: RequestedBillingOrderLine[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingOrderModelError("invalid_request");
  const input = value as Record<string, unknown>;
  if (typeof input.organizationId !== "string" || !UUID_PATTERN.test(input.organizationId) ||
      !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
    throw new BillingOrderModelError("invalid_request");
  }

  const seen = new Set<string>();
  const lines = input.lines.map((value): RequestedBillingOrderLine => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingOrderModelError("invalid_request");
    const line = value as Record<string, unknown>;
    if (typeof line.locationId !== "string" || !UUID_PATTERN.test(line.locationId) ||
        typeof line.productId !== "string" || !UUID_PATTERN.test(line.productId) ||
        typeof line.durationMonths !== "number" || !Number.isInteger(line.durationMonths) || line.durationMonths < 1 || line.durationMonths > 12) {
      throw new BillingOrderModelError("invalid_request");
    }
    const normalized = {
      locationId: line.locationId.toLowerCase(),
      productId: line.productId.toLowerCase(),
      durationMonths: line.durationMonths,
    };
    const identity = `${normalized.locationId}:${normalized.productId}`;
    if (seen.has(identity)) throw new BillingOrderModelError("duplicate_line");
    seen.add(identity);
    return normalized;
  });

  return { organizationId: input.organizationId.toLowerCase(), lines };
}

/** Product.priceMinor is intentionally not used: it is not provider/market scoped. */
export const fakeStagingBillingPricingAdapter: BillingPricingAdapter = {
  providerCode: FAKE_PROVIDER_CODE,
  quote(input) {
    if (!fakeProviderIsConfigured(input.env) || input.marketCode !== FAKE_PROVIDER_MARKET ||
        !Number.isInteger(input.durationMonths) || input.durationMonths < 1 || input.durationMonths > 12) return null;
    return {
      currency: FAKE_PAYMENT_CURRENCY,
      listAmountMinor: FAKE_PAYMENT_AMOUNT_MINOR * BigInt(input.durationMonths),
      discountAmountMinor: BigInt(0),
    };
  },
};

/** Resolve a route's quote through a provider-specific pricing adapter. */
export function quoteBillingRoute(input: {
  routeId: string;
  providerCode: string;
  marketCode: string;
  externalReference: string;
  displayOrder: number;
  durationMonths: number;
  env: FakeProviderEnvironment;
}, adapters: readonly BillingPricingAdapter[] = [fakeStagingBillingPricingAdapter]): BillingRouteQuoteCandidate | null {
  const result = adapters.find((adapter) => adapter.providerCode === input.providerCode)?.quote({
    providerCode: input.providerCode,
    marketCode: input.marketCode,
    durationMonths: input.durationMonths,
    env: input.env,
  });
  if (!result || !/^[A-Z]{3}$/.test(result.currency) || result.listAmountMinor < BigInt(0) ||
      result.discountAmountMinor < BigInt(0) || result.discountAmountMinor > result.listAmountMinor) return null;
  return {
    routeId: input.routeId,
    providerCode: input.providerCode,
    currency: result.currency,
    marketCode: input.marketCode,
    externalReference: input.externalReference,
    displayOrder: input.displayOrder,
    listAmountMinor: result.listAmountMinor,
    discountAmountMinor: result.discountAmountMinor,
  };
}

function compareRoute(left: BillingRouteQuoteCandidate, right: BillingRouteQuoteCandidate): number {
  return left.displayOrder - right.displayOrder || left.providerCode.localeCompare(right.providerCode) ||
    left.currency.localeCompare(right.currency) || left.externalReference.localeCompare(right.externalReference) ||
    left.routeId.localeCompare(right.routeId);
}

/** Pick one provider+currency that can price every line, then select routes deterministically. */
export function selectCompatibleBillingQuotes(groups: readonly (readonly BillingRouteQuoteCandidate[])[]): SelectedBillingRouteQuote[] {
  if (groups.length === 0 || groups.some((group) => group.length === 0)) throw new BillingOrderModelError("unsupported_pricing");
  const pairKey = (candidate: BillingRouteQuoteCandidate) => `${candidate.providerCode}\u0000${candidate.currency}`;
  const commonPairs = [...new Set(groups[0].map(pairKey))]
    .filter((key) => groups.every((group) => group.some((candidate) => pairKey(candidate) === key)))
    .sort((left, right) => left.localeCompare(right));
  const selectedPair = commonPairs[0];
  if (!selectedPair) throw new BillingOrderModelError("incompatible_routes");

  return groups.map((group) => {
    const candidate = group.filter((item) => pairKey(item) === selectedPair).sort(compareRoute)[0];
    return { ...candidate, amountMinor: candidate.listAmountMinor - candidate.discountAmountMinor };
  });
}
