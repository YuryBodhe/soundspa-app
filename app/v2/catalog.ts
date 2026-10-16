import type { getPublishedContentCatalog } from "../../db/v2/queries/content";
import type { CustomerCatalogChannel } from "@/lib/v2/customerCatalog";
import { resolveImageUrl, resolveMediaUrl } from "./mediaUrls";

export type PlayerChannel = {
  id: string; slug: string; kind: "music" | "ambient"; title: string;
  mood: string; image: string | null; playable?: boolean; accessSources?: string[]; accessExpiries?: Record<string,string>;
  localizedTitles?: Record<string, string>; tracks: { id: string; url: string; sizeBytes: string; originalFilename?: string }[];
  catalogProducts?: Array<{ id: string; name: string }>;
};

/** Build an account handoff from customer-safe catalog membership hints. */
export function playerUpgradeAccountHref(locationId: string | undefined, productIds: string[]): string | null {
  if (!locationId?.trim()) return null;
  const params = new URLSearchParams({ source: "player-upgrade", locationId: locationId.trim() });
  for (const productId of [...new Set(productIds.map((id) => id.trim()).filter(Boolean))]) params.append("productId", productId);
  return `/account?${params.toString()}`;
}

// Existing visual captions only: these do not define catalog entries/playlists.
const musicCaptions: Record<string, string> = {
  divnitsa: "Deep relaxation", relax: "Calm and restorative", "432": "Soft and meditative",
};

export function toPlayerCatalog(content: Awaited<ReturnType<typeof getPublishedContentCatalog>>): PlayerChannel[] {
  return content.map((channel) => ({
    id: channel.id, slug: channel.slug, kind: channel.kind, title: channel.displayName, localizedTitles: channel.localizedTitles ?? {},
    mood: channel.description ?? (channel.kind === "music" ? musicCaptions[channel.slug] ?? "" : ""),
    image: resolveImageUrl(channel.imageKey),
    tracks: channel.tracks.map((track) => ({
      id: track.id,
      url: resolveMediaUrl(channel.kind, track.storageKey),
      sizeBytes: track.sizeBytes.toString(),
      ...(channel.kind === "music" ? { originalFilename: track.originalFilename } : {}),
    })),
  }));
}

/** Preserve customer-safe Product membership metadata for player explanations. */
export function toCustomerPlayerChannels(channels: CustomerCatalogChannel[]): PlayerChannel[] {
  return channels.map((channel) => ({
    id: channel.id,
    slug: channel.slug,
    kind: channel.kind,
    title: channel.displayName,
    localizedTitles: channel.localizedTitles,
    mood: channel.description ?? "",
    image: channel.imageUrl,
    playable: channel.playable,
    accessSources: channel.accessSources,
    accessExpiries: channel.accessExpiries,
    catalogProducts: (channel.catalogProducts ?? []).map(({ id, name }) => ({ id, name })),
    tracks: channel.tracks,
  }));
}
