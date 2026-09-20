import { asc, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { baseChannels, channels } from "../schema";

export async function getBaseChannelIds(db: Pick<typeof v2Db, "select"> = v2Db): Promise<string[]> {
  const rows = await db.select({ channelId: baseChannels.channelId }).from(baseChannels).orderBy(asc(baseChannels.channelId));
  return rows.map((row) => row.channelId);
}

export async function getBaseChannels(db: Pick<typeof v2Db, "select"> = v2Db) {
  return db.select({ channel: channels }).from(baseChannels)
    .innerJoin(channels, eq(channels.id, baseChannels.channelId))
    .orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.id));
}

export async function addBaseChannel(channelId: string, db: Pick<typeof v2Db, "select" | "insert"> = v2Db) {
  const [channel] = await db.select({ id: channels.id, isPublished: channels.isPublished, archivedAt: channels.archivedAt }).from(channels).where(eq(channels.id, channelId));
  if (!channel || !channel.isPublished || channel.archivedAt) throw new Error("Channel is not eligible for Base.");
  await db.insert(baseChannels).values({ channelId }).onConflictDoNothing();
}
export async function removeBaseChannel(channelId: string, db: Pick<typeof v2Db, "delete"> = v2Db) {
  await db.delete(baseChannels).where(eq(baseChannels.channelId, channelId));
}
