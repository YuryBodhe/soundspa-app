import type { CustomerCatalogProductPolicy } from "@/db/v2/queries/customerCatalogPolicy";

type CustomerCatalogChannel = {
  id: string;
  accessSources: readonly string[];
  productAccessSources: Readonly<Record<string, readonly string[]>>;
  playable: boolean;
  tracks: readonly unknown[];
};

export type CustomerCatalogProduct = { id: string; name: string };

/**
 * List channels from public Products or Products assigned to this Location or
 * its Organization. Product-bound channels require an active Product source to
 * play; generic legacy channel grants only apply to channels outside Products.
 */
export function filterCustomerCatalogChannels<T extends CustomerCatalogChannel>(
  channels: readonly T[],
  hiddenChannelIds: ReadonlySet<string>,
  policy: CustomerCatalogProductPolicy,
): Array<T & { catalogProducts: CustomerCatalogProduct[] }> {
  const result: Array<T & { catalogProducts: CustomerCatalogProduct[] }> = [];
  for (const channel of channels) {
    if (hiddenChannelIds.has(channel.id)) continue;

    const productIds = [...policy.productChannelIds]
      .filter(([, channelIds]) => channelIds.has(channel.id))
      .map(([productId]) => productId);
    if (productIds.length === 0) {
      if (channel.accessSources.length > 0) result.push({ ...channel, catalogProducts: [] });
      continue;
    }

    const visibleProductIds = productIds.filter((productId) =>
      policy.publicProductIds.has(productId) || policy.assignedProductIds.has(productId));
    if (visibleProductIds.length === 0) continue;

    const productSources = [...new Set(productIds.flatMap((productId) => channel.productAccessSources[productId] ?? []))];
    const playable = channel.playable && productSources.length > 0;
    const catalogProducts = visibleProductIds
      .flatMap((id) => {
        const name = policy.productDisplayNames.get(id);
        return name === undefined ? [] : [{ id, name }];
      })
      .sort((left, right) => {
        if (left.name !== right.name) return left.name < right.name ? -1 : 1;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
    result.push({
      ...channel,
      catalogProducts,
      accessSources: productSources,
      playable,
      tracks: playable ? channel.tracks : [],
    });
  }
  return result;
}
