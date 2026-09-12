import { relations } from "drizzle-orm";
import { channels } from "./channels";
import { channelTracks } from "./channelTracks";

export const channelRelations = relations(channels, ({ many }) => ({
  tracks: many(channelTracks),
}));
export const channelTrackRelations = relations(channelTracks, ({ one }) => ({
  channel: one(channels, { fields: [channelTracks.channelId], references: [channels.id] }),
}));
