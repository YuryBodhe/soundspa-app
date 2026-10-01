import { and, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { locationChannelVisibility } from "../schema";

type VisibilityReadDb = Pick<typeof v2Db, "select">;
type VisibilityWriteDb = Pick<typeof v2Db, "insert" | "delete">;

export async function getHiddenChannelIds(locationId: string, db: VisibilityReadDb = v2Db): Promise<Set<string>> {
  const rows = await db.select({ channelId: locationChannelVisibility.channelId }).from(locationChannelVisibility).where(eq(locationChannelVisibility.locationId, locationId));
  return new Set(rows.map((row) => row.channelId));
}

export function filterVisibleChannels<T extends { id: string }>(channels: readonly T[], hiddenChannelIds: ReadonlySet<string>): T[] {
  return channels.filter((channel) => !hiddenChannelIds.has(channel.id));
}

export async function hideChannelForLocation(locationId: string, channelId: string, db: VisibilityWriteDb = v2Db): Promise<void> {
  await db.insert(locationChannelVisibility).values({ locationId, channelId, hidden: true }).onConflictDoNothing();
}

export async function showChannelForLocation(locationId: string, channelId: string, db: VisibilityWriteDb = v2Db): Promise<void> {
  await db.delete(locationChannelVisibility).where(and(eq(locationChannelVisibility.locationId, locationId), eq(locationChannelVisibility.channelId, channelId)));
}
