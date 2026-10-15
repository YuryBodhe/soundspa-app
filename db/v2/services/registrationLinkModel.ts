export type RegistrationLinkLifecycleInput = {
  disabledAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
};

export function getRegistrationLinkLifecycleStatus(link: RegistrationLinkLifecycleInput, redeemedCount: number, now = new Date()) {
  if (link.disabledAt) return "disabled" as const;
  if (link.expiresAt && link.expiresAt <= now) return "expired" as const;
  if (link.maxRedemptions !== null && redeemedCount >= link.maxRedemptions) return "exhausted" as const;
  return "active" as const;
}
