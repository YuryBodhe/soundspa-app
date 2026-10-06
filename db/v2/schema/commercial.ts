import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commercialProductKind, commercialProvider, commercialSubscriptionStatus, commercialTrialStatus } from "./enums";
import { organizations } from "./core/organizations";
import { locations } from "./core/locations";
import { channels } from "./product/channels";

export const commercialProducts = pgTable("commercial_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
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
  uniqueIndex("commercial_products_code_unique").on(table.code),
]);

export const commercialProductChannels = pgTable("commercial_product_channels", {
  productId: uuid("product_id").notNull(),
  channelId: uuid("channel_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.productId, table.channelId] }),
  foreignKey({ name: "commercial_product_channels_product_id_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_product_channels_channel_id_fk", columns: [table.channelId], foreignColumns: [channels.id] }).onDelete("restrict"),
]);

export const commercialPartners = pgTable("commercial_partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("commercial_partners_name_nonempty", sql`length(btrim(${table.name})) > 0`),
  uniqueIndex("commercial_partners_code_unique").on(table.code),
]);

export const commercialPartnerBenefits = pgTable("commercial_partner_benefits", {
  id: uuid("id").defaultRandom().primaryKey(),
  partnerId: uuid("partner_id").notNull(),
  productId: uuid("product_id").notNull(),
  locationId: uuid("location_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_partner_benefits_unique_period").on(table.partnerId, table.productId, table.locationId, table.startsAt),
  foreignKey({ name: "commercial_partner_benefits_partner_fk", columns: [table.partnerId], foreignColumns: [commercialPartners.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_partner_benefits_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_partner_benefits_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
  check("commercial_partner_benefits_window", sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
]);

export const locationCoreTrials = pgTable("location_core_trials", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull(),
  productId: uuid("product_id").notNull(),
  status: commercialTrialStatus("status").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("location_core_trials_location_product_unique").on(table.locationId, table.productId),
  foreignKey({ name: "location_core_trials_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
  foreignKey({ name: "location_core_trials_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  check("location_core_trials_window", sql`${table.endsAt} > ${table.startsAt}`),
]);

export const locationSubscriptions = pgTable("location_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull(),
  productId: uuid("product_id").notNull(),
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
  foreignKey({ name: "location_subscriptions_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
  foreignKey({ name: "location_subscriptions_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  check("location_subscriptions_price_pair", sql`(${table.priceMinor} IS NULL AND ${table.currency} IS NULL) OR (${table.priceMinor} >= 0 AND ${table.currency} IS NOT NULL AND length(btrim(${table.currency})) = 3)`),
  check("location_subscriptions_period_after_start", sql`${table.currentPeriodEndsAt} IS NULL OR ${table.currentPeriodEndsAt} > ${table.startsAt}`),
]);

export const commercialOrganizationPayerReference = pgTable("commercial_organization_payer_references", {
  organizationId: uuid("organization_id").primaryKey(),
  provider: commercialProvider("provider").notNull(),
  providerCustomerRef: text("provider_customer_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "commercial_organization_payer_references_organization_fk", columns: [table.organizationId], foreignColumns: [organizations.id] }).onDelete("restrict"),
]);
