export type CommercialSource = "trial" | "subscription" | "partner_benefit" | "add_on";
export type CommercialProductKind = "core" | "partner" | "addon";

/**
 * Domain-only shape for the foundation gate. It deliberately has no resolver
 * behavior: Gate 5C.1 only defines records that a later access service can
 * consume and emit lifecycle events for.
 */
export type CommercialProduct = { id: string; code: string; kind: CommercialProductKind };
export type LocationCommercialSource = {
  locationId: string;
  productId: string;
  source: CommercialSource;
  startsAt: Date;
  endsAt: Date | null;
};

export function isSourceActive(source: LocationCommercialSource, now: Date): boolean {
  return source.startsAt <= now && (source.endsAt === null || source.endsAt > now);
}
