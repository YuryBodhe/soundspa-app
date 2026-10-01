import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations } from "../core/locations";
import { channels } from "../product/channels";

// Rows are sparse exceptions: an existing row means hidden; absence means visible.
export const locationChannelVisibility = pgTable("location_channel_visibility", {
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  hidden: boolean("hidden").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.locationId, table.channelId] }),
  check("location_channel_visibility_hidden_only", sql`${table.hidden} IS TRUE`),
]);
