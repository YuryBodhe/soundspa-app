import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { channels } from "./channels";

// Each storage key identifies immutable media. Replacement creates a new track/key
// and disables the previous track; it must not overwrite the existing file.
export const channelTracks = pgTable("channel_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  storageKey: text("storage_key").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("channel_tracks_size_positive", sql`${table.sizeBytes} > 0`),
  check("channel_tracks_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  check("channel_tracks_storage_key_nonempty", sql`length(btrim(${table.storageKey})) > 0`),
  check("channel_tracks_original_filename_nonempty", sql`length(btrim(${table.originalFilename})) > 0`),
  index("channel_tracks_playlist_idx").on(table.channelId, table.sortOrder, table.id),
]);
