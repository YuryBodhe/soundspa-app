/**
 * Product assignment quotas are separate from the underlying entitlement. A
 * paid Basic or a separate Basic benefit/promotion removes the Basic Trial
 * device cap for Basic only. A grant with no configured quota must not inherit
 * a newly invented limit from a concurrent Trial entitlement.
 */
export type DeviceProductAccessBasis = "basic_trial" | "basic_paid" | "spaquatoria_gift" | "other";

export function deviceProductAssignmentLimit(productCode: string, accessBases: DeviceProductAccessBasis | readonly DeviceProductAccessBasis[]): number | null {
  const bases = Array.isArray(accessBases) ? accessBases : [accessBases];
  if (productCode === "soundspa") {
    if (bases.includes("basic_paid") || bases.includes("other")) return null;
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
