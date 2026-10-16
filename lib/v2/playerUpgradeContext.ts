const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_PLAYER_UPGRADE_PRODUCTS = 12;
const MAX_PLAYER_UPGRADE_CONTEXT_LENGTH = 4096;

export type PlayerUpgradeContext = {
  source: "player-upgrade";
  locationId: string;
  productIds: string[];
};

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function isPlayerUpgradeUuid(value: unknown): value is string {
  return normalizeUuid(value) !== null;
}

export function parsePlayerUpgradeContextFields(
  source: unknown,
  locationId: unknown,
  productIds: unknown,
): PlayerUpgradeContext | null {
  if (source !== "player-upgrade" || !Array.isArray(productIds) || productIds.length < 1 || productIds.length > MAX_PLAYER_UPGRADE_PRODUCTS) return null;
  const normalizedLocationId = normalizeUuid(locationId);
  if (!normalizedLocationId) return null;
  const normalizedProductIds = productIds.map(normalizeUuid);
  if (normalizedProductIds.some((id) => id === null)) return null;
  const uniqueProductIds = [...new Set(normalizedProductIds as string[])];
  if (!uniqueProductIds.length) return null;
  return { source: "player-upgrade", locationId: normalizedLocationId, productIds: uniqueProductIds };
}

/** Parses only the allowlisted player-upgrade hints; all other query values are ignored. */
export function parsePlayerUpgradeContext(search: string): PlayerUpgradeContext | null {
  if (search.length > MAX_PLAYER_UPGRADE_CONTEXT_LENGTH) return null;
  const params = new URLSearchParams(search.startsWith("#") || search.startsWith("?") ? search.slice(1) : search);
  if (params.getAll("source").length !== 1 || params.getAll("locationId").length !== 1) return null;
  return parsePlayerUpgradeContextFields(params.get("source"), params.get("locationId"), params.getAll("productId"));
}

export function playerUpgradeContextParams(context: PlayerUpgradeContext): URLSearchParams {
  const params = new URLSearchParams();
  params.set("source", "player-upgrade");
  params.set("locationId", context.locationId);
  for (const productId of context.productIds) params.append("productId", productId);
  return params;
}

export function playerUpgradeAccountPath(context: PlayerUpgradeContext): string {
  return `/account?${playerUpgradeContextParams(context).toString()}`;
}

export function playerUpgradeLoginPath(search: string): string {
  const context = parsePlayerUpgradeContext(search);
  return context ? `/login?${playerUpgradeContextParams(context).toString()}` : "/login";
}

export function removePlayerUpgradeContextParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("source");
  params.delete("locationId");
  params.delete("productId");
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
