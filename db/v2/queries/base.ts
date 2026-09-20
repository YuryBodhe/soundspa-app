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
