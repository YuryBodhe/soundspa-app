import type { CatalogAccess } from "./queries/access";

export type AccessPolicyInput = {
  accessType: "included" | "preview" | "subscribed" | null;
  enabled: boolean | null;
  expiresAt: Date | null;
  commercialActive: boolean;
  suspended: boolean;
  now: Date;
};

export function evaluateCatalogAccess(input: AccessPolicyInput): { access: CatalogAccess; playable: boolean } {
  if (!input.accessType) return { access: "locked", playable: false };
  if (!input.enabled) return { access: "disabled", playable: false };
  if (input.expiresAt && input.expiresAt <= input.now) return { access: "expired", playable: false };
  if (input.suspended) return { access: input.accessType, playable: false };
  if (input.accessType === "included") return { access: "included", playable: true };
  if (input.accessType === "preview") return { access: "preview", playable: Boolean(input.expiresAt && input.expiresAt > input.now) };
  return { access: "subscribed", playable: input.commercialActive };
}
