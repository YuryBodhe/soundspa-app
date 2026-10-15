import { resolveEffectiveChannelAccess } from "@/db/v2/queries/effectiveAccess";
import { getHiddenChannelIds } from "@/db/v2/queries/locationChannelVisibility";
import { resolveImageUrl, resolveMediaUrl } from "@/app/v2/mediaUrls";
import { getChannelLocalizedTitles } from "@/db/v2/queries/channelTranslations";
import { getCustomerCatalogProductPolicy } from "@/db/v2/queries/customerCatalogPolicy";
import { filterCustomerCatalogChannels } from "./customerCatalogModel";
export { filterCustomerCatalogChannels } from "./customerCatalogModel";

/** Customer-safe catalog shape shared by the device API and operator preview. */
export type CustomerCatalogChannel = {
  id: string;
  slug: string;
  displayName: string;
  kind: "music" | "ambient";
  description: string | null;
  imageUrl: string | null;
  localizedTitles: Record<string, string>;
  playable: boolean;
  suspended: boolean;
  accessSources: string[];
  accessExpiries: Record<string, string>;
  tracks: Array<{ id: string; url: string; sizeBytes: string; originalFilename?: string }>;
};

export async function getLocationCustomerCatalog(locationId: string, now = new Date()): Promise<CustomerCatalogChannel[]> {
  const [effectiveAccess, hiddenChannelIds, productPolicy] = await Promise.all([
    resolveEffectiveChannelAccess(locationId, now),
    getHiddenChannelIds(locationId),
    getCustomerCatalogProductPolicy(locationId),
  ]);
  const visible = filterCustomerCatalogChannels(effectiveAccess, hiddenChannelIds, productPolicy); const titles = await getChannelLocalizedTitles(visible.map((channel) => channel.id));
  return visible.map((channel) => ({
    id: channel.id,
    slug: channel.slug,
    displayName: channel.displayName,
    kind: channel.kind,
    description: channel.description,
    imageUrl: resolveImageUrl(channel.imageKey),
    playable: channel.playable,
    suspended: channel.suspended,
    accessSources: channel.accessSources,
    accessExpiries: Object.fromEntries(Object.entries(channel.accessExpiries).map(([key, value]) => [key, value.toISOString()])),
    localizedTitles: titles.get(channel.id) ?? {}, tracks: channel.playable ? channel.tracks.map((track) => ({
      id: track.id,
      url: resolveMediaUrl(channel.kind, track.storageKey),
      sizeBytes: track.sizeBytes.toString(),
      ...(channel.kind === "music" ? { originalFilename: track.originalFilename } : {}),
    })) : [],
  }));
}
