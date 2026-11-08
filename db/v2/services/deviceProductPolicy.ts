/**
 * Product assignment quotas are separate from the underlying entitlement. A
 * paid Basic subscription removes the Basic Trial device cap for Basic only.
 * Existing non-Gift products and historical benefit sources keep their current
 * behavior until a product-specific limit is explicitly defined.
 */
export type DeviceProductAccessBasis = "basic_trial" | "basic_paid" | "spaquatoria_gift" | "other";

export function deviceProductAssignmentLimit(productCode: string, accessBases: DeviceProductAccessBasis | readonly DeviceProductAccessBasis[]): number | null {
  const bases = Array.isArray(accessBases) ? accessBases : [accessBases];
  if (productCode === "soundspa") {
    if (bases.includes("basic_paid")) return null;
    if (bases.includes("basic_trial")) return 5;
    return null;
  }
  if (productCode === "spaquatoria" && bases.includes("spaquatoria_gift")) return 1;
  return null;
}

/** `null` means no configured cap; the caller still requires valid entitlement. */
export function canAssignActivatedDevice(limit: number | null, activatedAssignments: number): boolean {
  if (!Number.isSafeInteger(activatedAssignments) || activatedAssignments < 0) return false;
  if (limit === null) return true;
  return Number.isSafeInteger(limit) && limit >= 0 && activatedAssignments < limit;
}
