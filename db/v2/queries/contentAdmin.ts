import { asc, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { channels, channelTracks } from "../schema";

export async function listAdminChannels() {
  return v2Db.select().from(channels).orderBy(asc(channels.kind), asc(channels.sortOrder), asc(channels.id));
}

export async function getAdminChannel(id: string) {
  const [channel] = await v2Db.select().from(channels).where(eq(channels.id, id));
  if (!channel) return null;
  const tracks = await v2Db.select().from(channelTracks).where(eq(channelTracks.channelId, id))
    .orderBy(asc(channelTracks.sortOrder), asc(channelTracks.id));
  return { ...channel, tracks };
}
