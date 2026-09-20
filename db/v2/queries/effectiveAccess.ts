import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { v2Db } from "../client";
import { baseChannels, channels, channelTracks, locations, organizations, locationServiceAccess, locationChannelEntitlements, locationChannelGrants } from "../schema";
import { evaluateCatalogAccess } from "../accessPolicy";

export type EffectiveAccessSource = "base" | "included" | "preview" | "custom" | "admin";
export type EffectiveChannelAccess = {
  id: string; slug: string; displayName: string; kind: "music" | "ambient";
  description: string | null; imageKey: string | null; playable: boolean; suspended: boolean;
  accessSources: EffectiveAccessSource[]; underlyingSources: EffectiveAccessSource[];
  accessExpiries: { preview?: Date; custom?: Date; admin?: Date };
  tracks: { id: string; storageKey: string; originalFilename: string; sizeBytes: bigint; sortOrder: number }[];
};
const sourceOrder: EffectiveAccessSource[] = ["base", "included", "preview", "custom", "admin"];

export async function resolveEffectiveChannelAccess(locationId: string, serverNow: Date, db: Pick<typeof v2Db, "select"> = v2Db): Promise<EffectiveChannelAccess[]> {
  if (!Number.isFinite(serverNow.getTime())) throw new Error("Invalid server time");
  const rows = await db.select({
    id: channels.id, slug: channels.slug, displayName: channels.displayName, kind: channels.kind, description: channels.description, imageKey: channels.imageKey,
    baseMember: sql<boolean>`${baseChannels.channelId} IS NOT NULL`,
    commercialActive: sql<boolean>`(${locationServiceAccess.locationId} IS NOT NULL AND ${locationServiceAccess.suspendedAt} IS NULL AND (${locationServiceAccess.paidThrough} > ${serverNow} OR ${locationServiceAccess.trialEndsAt} > ${serverNow})) IS TRUE`,
    suspended: sql<boolean>`(${locationServiceAccess.suspendedAt} IS NOT NULL) IS TRUE`,
    accessType: locationChannelEntitlements.accessType, enabled: locationChannelEntitlements.enabled, expiresAt: locationChannelEntitlements.expiresAt,
    adminEnabled: locationChannelGrants.enabled, adminStartsAt: locationChannelGrants.startsAt, adminEndsAt: locationChannelGrants.endsAt,
    trackId: channelTracks.id, storageKey: channelTracks.storageKey, originalFilename: channelTracks.originalFilename, sizeBytes: channelTracks.sizeBytes, trackOrder: channelTracks.sortOrder,
  }).from(locations).innerJoin(organizations, and(eq(organizations.id, locations.organizationId), isNull(organizations.archivedAt)))
    .innerJoin(channels, and(eq(channels.isPublished, true), isNull(channels.archivedAt))).leftJoin(baseChannels, eq(baseChannels.channelId, channels.id))
    .leftJoin(locationServiceAccess, eq(locationServiceAccess.locationId, locations.id))
    .leftJoin(locationChannelEntitlements, and(eq(locationChannelEntitlements.locationId, locations.id), eq(locationChannelEntitlements.channelId, channels.id)))
    .leftJoin(locationChannelGrants, and(eq(locationChannelGrants.locationId, locations.id), eq(locationChannelGrants.channelId, channels.id), eq(locationChannelGrants.source, "admin")))
    .leftJoin(channelTracks, and(eq(channelTracks.channelId, channels.id), eq(channelTracks.isEnabled, true)))
    .where(and(eq(locations.id, locationId), isNull(locations.archivedAt))).orderBy(asc(channels.sortOrder), asc(channels.id), asc(channelTracks.sortOrder), asc(channelTracks.id));
  const result = new Map<string, EffectiveChannelAccess>();
  for (const row of rows) {
    const sourcePolicy = evaluateCatalogAccess({ accessType: row.accessType, enabled: row.enabled, expiresAt: row.expiresAt, commercialActive: row.commercialActive, suspended: false, now: serverNow });
    const underlying = new Set<EffectiveAccessSource>();
    if (row.baseMember) underlying.add("base");
    if (sourcePolicy.playable && row.accessType === "included") underlying.add("included");
    if (sourcePolicy.playable && row.accessType === "preview") underlying.add("preview");
    if (sourcePolicy.playable && row.accessType === "subscribed") underlying.add("custom");
    const adminValid = row.adminEnabled === true && (!row.adminStartsAt || row.adminStartsAt <= serverNow) && (!row.adminEndsAt || row.adminEndsAt > serverNow);
    if (adminValid) underlying.add("admin");
    const item = result.get(row.id) ?? { id: row.id, slug: row.slug, displayName: row.displayName, kind: row.kind, description: row.description, imageKey: row.imageKey, playable: false, suspended: row.suspended, accessSources: [], underlyingSources: [], accessExpiries: {}, tracks: [] };
    item.underlyingSources = sourceOrder.filter((source) => item.underlyingSources.includes(source) || underlying.has(source));
    item.accessSources = item.underlyingSources;
    if (row.expiresAt && row.accessType === "preview" && row.expiresAt > serverNow) item.accessExpiries.preview = row.expiresAt;
    if (adminValid && row.adminEndsAt) item.accessExpiries.admin = row.adminEndsAt;
    item.playable = item.underlyingSources.length > 0 && !row.suspended;
    if (item.playable && row.trackId && row.storageKey && row.originalFilename && row.sizeBytes !== null && row.trackOrder !== null) item.tracks.push({ id: row.trackId, storageKey: row.storageKey, originalFilename: row.originalFilename, sizeBytes: row.sizeBytes, sortOrder: row.trackOrder });
    result.set(row.id, item);
  }
  return [...result.values()];
}
