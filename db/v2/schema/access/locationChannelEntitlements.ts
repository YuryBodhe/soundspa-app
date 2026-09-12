import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { locations } from "../core/locations";
import { channels } from "../product/channels";
import { entitlementType } from "../enums";

export const locationChannelEntitlements = pgTable("location_channel_entitlements", {
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  accessType: entitlementType("access_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.locationId, table.channelId] }),
  index("location_channel_entitlements_channel_idx").on(table.channelId),
  check("location_channel_entitlements_preview_expiry", sql`${table.accessType} <> 'preview' OR ${table.expiresAt} IS NOT NULL`),
]);
