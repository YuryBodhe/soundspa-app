import { isPlayerUpgradeUuid, parsePlayerUpgradeContext } from "@/lib/v2/playerUpgradeContext";

export type PlayerUpgradeBillingLocation = {
  id: string;
  organizationId: string;
  products: Array<{ productId: string; purchaseEligible: boolean }>;
};

export type PlayerUpgradeHandoff = {
  requestId: string;
  organizationId: string;
  locationId: string;
  eligibleProductIds: string[];
  selectedProductIds: string[];
  unavailableProductCount: number;
};

export function buildPlayerUpgradeWizardSelection(handoff: PlayerUpgradeHandoff): Record<string, string[]> {
  return handoff.selectedProductIds.length
    ? { [handoff.locationId]: [...handoff.selectedProductIds] }
    : {};
}

export type PlayerUpgradeHandoffResolution =
  | { status: "not_requested" }
  | { status: "invalid_location" }
  | { status: "unavailable" }
  | { status: "ready"; handoff: PlayerUpgradeHandoff };

/** Query values are hints. Eligibility comes only from the authenticated billing response. */
export function resolvePlayerUpgradeHandoff(search: string, locations: PlayerUpgradeBillingLocation[]): PlayerUpgradeHandoffResolution {
  const params = new URLSearchParams(search);
  if (params.get("source") !== "player-upgrade") return { status: "not_requested" };

  const context = parsePlayerUpgradeContext(search);
  const rawLocationId = params.get("locationId")?.trim() ?? "";
  if (!isPlayerUpgradeUuid(rawLocationId)) return { status: "invalid_location" };
  const locationId = rawLocationId.toLowerCase();
  const location = locations.find((candidate) => candidate.id.toLowerCase() === locationId);
  if (!location) return { status: "invalid_location" };

  if (!context) return { status: "unavailable" };
  const requestedProductIds = context.productIds;
  const eligibleProductIds = requestedProductIds.filter((productId) =>
    location.products.some((product) => product.productId.toLowerCase() === productId && product.purchaseEligible),
  );
  if (eligibleProductIds.length === 0) return { status: "unavailable" };

  return {
    status: "ready",
    handoff: {
      requestId: `${location.id}:${requestedProductIds.join(",")}`,
      organizationId: location.organizationId,
      locationId: location.id,
      eligibleProductIds,
      // A single validated offer is convenient to preselect. Multiple offers require an explicit choice.
      selectedProductIds: eligibleProductIds.length === 1 ? eligibleProductIds : [],
      unavailableProductCount: requestedProductIds.length - eligibleProductIds.length,
    },
  };
}
