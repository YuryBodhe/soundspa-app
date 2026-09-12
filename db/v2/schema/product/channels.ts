import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { channelKind } from "../enums";

export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  kind: channelKind("kind").notNull(),
  description: text("description"),
  imageKey: text("image_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  isPublished: boolean("is_published").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("channels_display_name_nonempty", sql`length(btrim(${table.displayName})) > 0`),
  check("channels_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("channels_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  index("channels_catalog_idx").on(table.kind, table.isPublished, table.sortOrder),
]);
