export type ProductVisibility = "public" | "private" | "disabled";

export type ProductPurchaseDecision =
  | { eligible: true }
  | { eligible: false; reason: "product_unavailable" };

/** Purchase policy only. It must not be used by entitlement/access resolvers. */
export function evaluateProductPurchaseEligibility(input: {
  isActive: boolean;
  visibility: ProductVisibility;
  hasOrganizationAuthorization: boolean;
}): ProductPurchaseDecision {
  if (!input.isActive || input.visibility === "disabled" ||
      (input.visibility === "private" && !input.hasOrganizationAuthorization)) {
    return { eligible: false, reason: "product_unavailable" };
  }
  return { eligible: true };
}
