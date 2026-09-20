import { relations } from "drizzle-orm";
import { channels } from "./channels";
import { channelTracks } from "./channelTracks";
import { baseChannels } from "../access/baseChannels";

export const channelRelations = relations(channels, ({ many }) => ({
  tracks: many(channelTracks),
  baseMembership: many(baseChannels),
}));
export const channelTrackRelations = relations(channelTracks, ({ one }) => ({
  channel: one(channels, { fields: [channelTracks.channelId], references: [channels.id] }),
}));
