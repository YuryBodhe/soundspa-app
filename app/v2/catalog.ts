import type { getPublishedContentCatalog } from "../../db/v2/queries/content";
import { resolveImageUrl, resolveMediaUrl } from "./mediaUrls";

export type PlayerChannel = {
  id: string; slug: string; kind: "music" | "ambient"; title: string;
  mood: string; image: string | null;
  tracks: { id: string; url: string; sizeBytes: string }[];
};

// Existing visual captions only: these do not define catalog entries/playlists.
const musicCaptions: Record<string, string> = {
  divnitsa: "Deep relaxation", relax: "Calm and restorative", "432": "Soft and meditative",
};

export function toPlayerCatalog(content: Awaited<ReturnType<typeof getPublishedContentCatalog>>): PlayerChannel[] {
  return content.map((channel) => ({
    id: channel.id, slug: channel.slug, kind: channel.kind, title: channel.displayName,
    mood: channel.description ?? (channel.kind === "music" ? musicCaptions[channel.slug] ?? "" : ""),
    image: resolveImageUrl(channel.imageKey),
    tracks: channel.tracks.map((track) => ({ id: track.id, url: resolveMediaUrl(channel.kind, track.storageKey), sizeBytes: track.sizeBytes.toString() })),
  }));
}
