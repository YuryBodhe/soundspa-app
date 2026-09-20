import { and, asc, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { channels, locationChannelGrants } from "../schema";

export type AdminGrantInput = { locationId: string; channelId: string; enabled?: boolean; startsAt?: Date | null; endsAt?: Date | null };
export async function getLocationAdminGrants(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  return db.select({ grant: locationChannelGrants, channel: channels }).from(locationChannelGrants).innerJoin(channels, eq(channels.id, locationChannelGrants.channelId)).where(and(eq(locationChannelGrants.locationId, locationId), eq(locationChannelGrants.source, "admin"))).orderBy(asc(channels.sortOrder), asc(channels.id));
}
export async function upsertLocationAdminGrant(input: AdminGrantInput, db: Pick<typeof v2Db, "insert"> = v2Db) {
  const values = { ...input, source: "admin" as const, enabled: input.enabled ?? true };
  const [grant] = await db.insert(locationChannelGrants).values(values).onConflictDoUpdate({ target: [locationChannelGrants.locationId, locationChannelGrants.channelId, locationChannelGrants.source], set: { enabled: values.enabled, startsAt: values.startsAt ?? null, endsAt: values.endsAt ?? null, updatedAt: new Date() } }).returning();
  return grant;
}
export async function disableLocationAdminGrant(locationId: string, channelId: string, db: Pick<typeof v2Db, "update"> = v2Db) {
  return db.update(locationChannelGrants).set({ enabled: false, updatedAt: new Date() }).where(and(eq(locationChannelGrants.locationId, locationId), eq(locationChannelGrants.channelId, channelId), eq(locationChannelGrants.source, "admin"))).returning();
}
export async function removeLocationAdminGrant(locationId: string, channelId: string, db: Pick<typeof v2Db, "delete"> = v2Db) {
  return db.delete(locationChannelGrants).where(and(eq(locationChannelGrants.locationId, locationId), eq(locationChannelGrants.channelId, channelId), eq(locationChannelGrants.source, "admin"))).returning();
}
