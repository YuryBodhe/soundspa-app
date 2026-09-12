import { and, asc, eq, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { channels, channelTracks } from "../schema";

// Content-only catalog. No Location, access projection or entitlement joins.
export async function getPublishedContentCatalog() {
  const rows = await v2Db.select({ channel: channels, track: channelTracks }).from(channels)
    .leftJoin(channelTracks, and(eq(channelTracks.channelId, channels.id), eq(channelTracks.isEnabled, true)))
    .where(and(eq(channels.isPublished, true), isNull(channels.archivedAt)))
    .orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.id), asc(channelTracks.sortOrder), asc(channelTracks.id));
  const catalog = new Map<string, typeof channels.$inferSelect & { tracks: (typeof channelTracks.$inferSelect)[] }>();
  for (const { channel, track } of rows) {
    let item = catalog.get(channel.id);
    if (!item) { item = { ...channel, tracks: [] }; catalog.set(channel.id, item); }
    if (track) item.tracks.push(track);
  }
  return [...catalog.values()];
}
