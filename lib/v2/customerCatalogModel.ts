import type { CustomerCatalogProductPolicy } from "@/db/v2/queries/customerCatalogPolicy";

type CustomerCatalogChannel = {
  id: string;
  accessSources: readonly string[];
  productAccessSources: Readonly<Record<string, readonly string[]>>;
  playable: boolean;
  tracks: readonly unknown[];
};

/**
 * List channels from public Products or Products assigned to this Location or
 * its Organization. Product-bound channels require an active Product source to
 * play; generic legacy channel grants only apply to channels outside Products.
 */
export function filterCustomerCatalogChannels<T extends CustomerCatalogChannel>(
  channels: readonly T[],
  hiddenChannelIds: ReadonlySet<string>,
  policy: CustomerCatalogProductPolicy,
): T[] {
  const result: T[] = [];
  for (const channel of channels) {
    if (hiddenChannelIds.has(channel.id)) continue;

    const productIds = [...policy.productChannelIds]
      .filter(([, channelIds]) => channelIds.has(channel.id))
      .map(([productId]) => productId);
    if (productIds.length === 0) {
      if (channel.accessSources.length > 0) result.push(channel);
      continue;
    }

    const visible = productIds.some((productId) =>
      policy.publicProductIds.has(productId) || policy.assignedProductIds.has(productId));
    if (!visible) continue;

    const productSources = [...new Set(productIds.flatMap((productId) => channel.productAccessSources[productId] ?? []))];
    const playable = channel.playable && productSources.length > 0;
    result.push({
      ...channel,
      accessSources: productSources,
      playable,
      tracks: playable ? channel.tracks : [],
    });
  }
  return result;
}
