import { sql } from "drizzle-orm";
import { boolean, check, index, text, timestamp, uniqueIndex, uuid, pgTable } from "drizzle-orm/pg-core";
import { locations } from "../core/locations";
import { channels } from "../product/channels";

export const locationChannelGrants = pgTable("location_channel_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  source: text("source").notNull().default("admin"),
  enabled: boolean("enabled").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("location_channel_grants_unique_source").on(table.locationId, table.channelId, table.source),
  index("location_channel_grants_channel_idx").on(table.channelId),
  check("location_channel_grants_source", sql`${table.source} = 'admin'`),
  check("location_channel_grants_window", sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
]);
