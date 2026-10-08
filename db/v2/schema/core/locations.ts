import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const locations = pgTable("locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(),
  // Payment market is explicit and independent from the customer's UI locale.
  // Nullable for existing Locations until an owner/admin supplies a market.
  marketCode: text("market_code"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("locations_organization_idx").on(table.organizationId),
  uniqueIndex("locations_id_organization_unique").on(table.id, table.organizationId),
  check("locations_name_nonempty", sql`length(btrim(${table.name})) > 0`),
  check("locations_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("locations_timezone_nonempty", sql`length(btrim(${table.timezone})) > 0`),
  check("locations_market_code_format", sql`${table.marketCode} IS NULL OR ${table.marketCode} ~ '^[A-Z]{2}$'`),
]);
