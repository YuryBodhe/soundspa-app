export const normalizedPaymentStatuses = ["pending", "succeeded", "failed", "canceled", "refunded", "partially_refunded"] as const;
export type NormalizedPaymentStatus = typeof normalizedPaymentStatuses[number];

export type PaymentRouteChoice = {
  id: string;
  providerCode: string;
  externalReference: string;
  displayOrder: number;
  createdAt: Date | string;
  isEnabled: boolean;
  providerEnabled: boolean;
};

export function isMarketCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

// Deliberately accepts only the explicit Location market. It never uses locale,
// timezone, browser headers, or country inference as a fallback.
export function explicitMarketCode(value: unknown): string | null {
  return value == null ? null : isMarketCode(value) ? value : null;
}

export function selectEnabledPaymentRoutes<T extends PaymentRouteChoice>(routes: readonly T[]): T[] {
  return routes.filter((route) => route.isEnabled && route.providerEnabled).slice().sort((left, right) =>
    left.displayOrder - right.displayOrder ||
    left.providerCode.localeCompare(right.providerCode) ||
    left.externalReference.localeCompare(right.externalReference) ||
    left.id.localeCompare(right.id));
}

export type NormalizedPaymentInput = {
  providerCode: string;
  paymentKey: string;
  idempotencyKey: string;
  externalEventId: string | null;
  externalPaymentId: string | null;
  locationId: string;
  productId: string;
  subscriptionId: string | null;
  routeId: string | null;
  externalSubscriptionRef: string | null;
  status: NormalizedPaymentStatus;
  amountMinor: bigint;
  currency: string;
  occurredAt: Date | null;
};

export function validateNormalizedPaymentInput(input: NormalizedPaymentInput): NormalizedPaymentInput {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.providerCode)) throw new Error("invalid_provider_code");
  for (const [field, value] of [["payment_key", input.paymentKey], ["idempotency_key", input.idempotencyKey]] as const) {
    if (typeof value !== "string" || !value.trim() || value.length > 512) throw new Error(`invalid_${field}`);
  }
  if (input.externalEventId !== null && (!input.externalEventId.trim() || input.externalEventId.length > 512)) throw new Error("invalid_external_event_id");
  if (input.externalPaymentId !== null && (!input.externalPaymentId.trim() || input.externalPaymentId.length > 512)) throw new Error("invalid_external_payment_id");
  if (!normalizedPaymentStatuses.includes(input.status)) throw new Error("invalid_payment_status");
  if (typeof input.amountMinor !== "bigint" || input.amountMinor < BigInt(0)) throw new Error("invalid_payment_amount");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("invalid_payment_currency");
  if (input.occurredAt !== null && !Number.isFinite(input.occurredAt.getTime())) throw new Error("invalid_payment_timestamp");
  return input;
}

export function samePaymentIdentity(existing: {
  locationId: string | null; productId: string | null; subscriptionId: string | null; routeId: string | null;
  paymentKey: string; externalPaymentId: string | null; externalSubscriptionRef: string | null; amountMinor: bigint; currency: string;
}, incoming: NormalizedPaymentInput): boolean {
  return existing.locationId === incoming.locationId &&
    existing.productId === incoming.productId &&
    existing.subscriptionId === incoming.subscriptionId &&
    existing.routeId === incoming.routeId &&
    existing.paymentKey === incoming.paymentKey &&
    existing.externalPaymentId === incoming.externalPaymentId &&
    existing.externalSubscriptionRef === incoming.externalSubscriptionRef &&
    existing.amountMinor === incoming.amountMinor &&
    existing.currency === incoming.currency;
}

export function incomingEventIsNewer(existingAt: Date | null, incomingAt: Date | null): boolean {
  if (existingAt === null || incomingAt === null) return true;
  return incomingAt.getTime() >= existingAt.getTime();
}

export function paymentEventIdentity(providerCode: string, idempotencyKey: string): string {
  return `${providerCode}:${idempotencyKey}`;
}

export function paymentTransactionIdentity(providerCode: string, paymentKey: string): string {
  return `${providerCode}:${paymentKey}`;
}
