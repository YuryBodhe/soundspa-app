import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { channels } from "../schema.pg";

// ---------- MEDIA FILES ----------

export const mediaFiles = pgTable("media_files", {
  id: serial("id").primaryKey(),

  filename: text("filename").notNull(),
  publicUrl: text("public_url").notNull().unique(),

  sizeBytes: integer("size_bytes"),
  durationSeconds: integer("duration_seconds"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------- PLAYLIST ITEMS ----------

export const playlistItems = pgTable(
  "playlist_items",
  {
    id: serial("id").primaryKey(),

    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    mediaFileId: integer("media_file_id")
      .notNull()
      .references(() => mediaFiles.id, { onDelete: "cascade" }),

    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => ({
    uniqueChannelPosition: uniqueIndex(
      "playlist_items_channel_position_unique",
    ).on(table.channelId, table.position),
  }),
);

// ---------- RELATIONS ----------

export const mediaFilesRelations = relations(mediaFiles, ({ many }) => ({
  playlistItems: many(playlistItems),
}));

export const playlistItemsRelations = relations(
  playlistItems,
  ({ one }) => ({
    channel: one(channels, {
      fields: [playlistItems.channelId],
      references: [channels.id],
    }),

    mediaFile: one(mediaFiles, {
      fields: [playlistItems.mediaFileId],
      references: [mediaFiles.id],
    }),
  }),
);
