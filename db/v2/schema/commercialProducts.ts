import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commercialProductKind } from "./enums";

export const commercialProducts = pgTable("commercial_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: commercialProductKind("kind").notNull(),
  priceMinor: integer("price_minor"),
  currency: text("currency"),
  billingIntervalMonths: integer("billing_interval_months"),
  isActive: boolean("is_active").notNull().default(true),
  // Purchase visibility is separate from activation/access resolution. Changing
  // visibility must not revoke any existing commercial entitlement.
  visibility: text("visibility").$type<"public" | "private" | "disabled">().notNull().default("public"),
  // Catalog visibility controls whether a Product's channels are listed before
  // a Location or its Organization has any entitlement/assignment history.
  catalogVisibility: text("catalog_visibility").$type<"public" | "assigned">().notNull().default("assigned"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("commercial_products_name_nonempty", sql`length(btrim(${table.name})) > 0`),
  check("commercial_products_price_pair", sql`(${table.priceMinor} IS NULL AND ${table.currency} IS NULL) OR (${table.priceMinor} >= 0 AND ${table.currency} IS NOT NULL AND length(btrim(${table.currency})) = 3)`),
  check("commercial_products_interval_positive", sql`${table.billingIntervalMonths} IS NULL OR ${table.billingIntervalMonths} > 0`),
  check("commercial_products_visibility_valid", sql`${table.visibility} IN ('public', 'private', 'disabled')`),
  check("commercial_products_catalog_visibility_valid", sql`${table.catalogVisibility} IN ('public', 'assigned')`),
  uniqueIndex("commercial_products_code_unique").on(table.code),
]);
