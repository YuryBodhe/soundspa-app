import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { v2Db } from "../client";
import { channels, channelTracks, locations, organizations, locationServiceAccess, locationChannelEntitlements } from "../schema";

export type CatalogAccess = "included" | "preview" | "subscribed" | "locked" | "expired" | "disabled";
type Track = { id: string; storageKey: string; sortOrder: number };
export type LocationCatalogChannel = {
  id: string; slug: string; displayName: string; kind: "music" | "ambient";
  description: string | null; imageKey: string | null;
  access: CatalogAccess; serviceActive: boolean; playable: boolean; tracks: Track[];
};

// Internal server-side query only: caller supplies trusted server time and must
// authorize the Location before exposing this result through any future API.
// Optional executor allows verification inside a rollback-only transaction.
export async function getLocationCatalog(locationId: string, serverNow: Date, db: Pick<typeof v2Db, "select"> = v2Db): Promise<LocationCatalogChannel[]> {
  if (!Number.isFinite(serverNow.getTime())) throw new Error("Invalid server time");
  const rows = await db.select({
    id: channels.id, slug: channels.slug, displayName: channels.displayName, kind: channels.kind,
    description: channels.description, imageKey: channels.imageKey,
    serviceActive: sql<boolean>`(${locationServiceAccess.locationId} IS NOT NULL AND ${locationServiceAccess.suspendedAt} IS NULL AND (${locationServiceAccess.paidThrough} > ${serverNow} OR ${locationServiceAccess.trialEndsAt} > ${serverNow})) IS TRUE`,
    accessType: locationChannelEntitlements.accessType, enabled: locationChannelEntitlements.enabled,
    expiresAt: locationChannelEntitlements.expiresAt,
    trackId: channelTracks.id, storageKey: channelTracks.storageKey, trackOrder: channelTracks.sortOrder,
  }).from(locations)
    .innerJoin(organizations, and(eq(organizations.id, locations.organizationId), isNull(organizations.archivedAt)))
    .innerJoin(channels, and(eq(channels.isPublished, true), isNull(channels.archivedAt)))
    .leftJoin(locationServiceAccess, eq(locationServiceAccess.locationId, locations.id))
    .leftJoin(locationChannelEntitlements, and(eq(locationChannelEntitlements.locationId, locations.id), eq(locationChannelEntitlements.channelId, channels.id)))
    .leftJoin(channelTracks, and(eq(channelTracks.channelId, channels.id), eq(channelTracks.isEnabled, true)))
    .where(and(eq(locations.id, locationId), isNull(locations.archivedAt)))
    .orderBy(asc(channels.sortOrder), asc(channels.id), asc(channelTracks.sortOrder), asc(channelTracks.id));
  const catalog = new Map<string, LocationCatalogChannel>();
  for (const row of rows) {
    const access: CatalogAccess = !row.accessType ? "locked" : !row.enabled ? "disabled"
      : row.expiresAt && row.expiresAt <= serverNow ? "expired" : row.accessType;
    const entitled = access === "included" || access === "preview" || access === "subscribed";
    let item = catalog.get(row.id);
    if (!item) {
      item = { id: row.id, slug: row.slug, displayName: row.displayName, kind: row.kind,
        description: row.description, imageKey: row.imageKey, access,
        serviceActive: row.serviceActive, playable: false, tracks: [] };
      catalog.set(row.id, item);
    }
    // Never return storage identities for denied service/entitlements.
    if (row.serviceActive && entitled && row.trackId && row.storageKey && row.trackOrder !== null) {
      item.tracks.push({ id: row.trackId, storageKey: row.storageKey, sortOrder: row.trackOrder });
      item.playable = true;
    }
  }
  return [...catalog.values()];
}

export async function getPlayableChannelsForLocation(locationId: string, serverNow: Date, db: Pick<typeof v2Db, "select"> = v2Db) {
  return (await getLocationCatalog(locationId, serverNow, db)).filter((channel) => channel.playable);
}
