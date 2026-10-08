export function validateProviderPaidThrough(occurredAt: Date, paidThroughAt: Date | null): Date {
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
    throw new Error("invalid_payment_timestamp");
  }
  if (!(paidThroughAt instanceof Date) || !Number.isFinite(paidThroughAt.getTime())) {
    throw new Error("provider_paid_through_required");
  }
  if (paidThroughAt.getTime() <= occurredAt.getTime()) {
    throw new Error("invalid_provider_paid_through");
  }
  return paidThroughAt;
}

/**
 * A null period end means the existing access resolver treats the subscription
 * as unbounded. Preserve that accepted meaning rather than shortening it to a
 * finite period received in a later event.
 */
export function preserveLatestPaidThrough(current: Date | null, incoming: Date): Date | null {
  if (current === null) return null;
  return current.getTime() >= incoming.getTime() ? current : incoming;
}

/** A payment after cancellation may reactivate; an older/equal event may not. */
export function paymentCanRestoreCanceledSubscription(occurredAt: Date, canceledAt: Date | null): boolean {
  return canceledAt === null || occurredAt.getTime() > canceledAt.getTime();
}
