import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commercialProductKind, commercialProvider, commercialSubscriptionStatus, commercialTrialStatus } from "./enums";
import { organizations } from "./core/organizations";
import { locations } from "./core/locations";
import { channels } from "./product/channels";

export const commercialProducts = pgTable("commercial_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: commercialProductKind("kind").notNull(),
  priceMinor: integer("price_minor"),
  currency: text("currency"),
  billingIntervalMonths: integer("billing_interval_months"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("commercial_products_name_nonempty", sql`length(btrim(${table.name})) > 0`),
  check("commercial_products_price_pair", sql`(${table.priceMinor} IS NULL AND ${table.currency} IS NULL) OR (${table.priceMinor} >= 0 AND ${table.currency} IS NOT NULL AND length(btrim(${table.currency})) = 3)`),
  check("commercial_products_interval_positive", sql`${table.billingIntervalMonths} IS NULL OR ${table.billingIntervalMonths} > 0`),
]);

export const commercialProductChannels = pgTable("commercial_product_channels", {
  productId: uuid("product_id").notNull().references(() => commercialProducts.id, { onDelete: "restrict" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.productId, table.channelId] })]);

export const commercialPartners = pgTable("commercial_partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("commercial_partners_name_nonempty", sql`length(btrim(${table.name})) > 0`)]);

export const commercialPartnerBenefits = pgTable("commercial_partner_benefits", {
  id: uuid("id").defaultRandom().primaryKey(),
  partnerId: uuid("partner_id").notNull().references(() => commercialPartners.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => commercialProducts.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_partner_benefits_unique_period").on(table.partnerId, table.productId, table.locationId, table.startsAt),
  check("commercial_partner_benefits_window", sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
]);

export const locationCoreTrials = pgTable("location_core_trials", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => commercialProducts.id, { onDelete: "restrict" }),
  status: commercialTrialStatus("status").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("location_core_trials_location_product_unique").on(table.locationId, table.productId),
  check("location_core_trials_window", sql`${table.endsAt} > ${table.startsAt}`),
]);

export const locationSubscriptions = pgTable("location_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => commercialProducts.id, { onDelete: "restrict" }),
  provider: commercialProvider("provider").notNull(),
  status: commercialSubscriptionStatus("status").notNull(),
  providerCustomerRef: text("provider_customer_ref"),
  providerSubscriptionRef: text("provider_subscription_ref"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  priceMinor: integer("price_minor"),
  currency: text("currency"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("location_subscriptions_provider_ref_unique").on(table.provider, table.providerSubscriptionRef),
  check("location_subscriptions_price_pair", sql`(${table.priceMinor} IS NULL AND ${table.currency} IS NULL) OR (${table.priceMinor} >= 0 AND ${table.currency} IS NOT NULL AND length(btrim(${table.currency})) = 3)`),
  check("location_subscriptions_period_after_start", sql`${table.currentPeriodEndsAt} IS NULL OR ${table.currentPeriodEndsAt} > ${table.startsAt}`),
]);

export const commercialOrganizationPayerReference = pgTable("commercial_organization_payer_references", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "restrict" }),
  provider: commercialProvider("provider").notNull(),
  providerCustomerRef: text("provider_customer_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
