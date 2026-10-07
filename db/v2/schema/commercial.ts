import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commercialOfferGrantType, commercialProductKind, commercialSubscriptionStatus, commercialTrialStatus } from "./enums";
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

export const commercialPaymentProviders = pgTable("commercial_payment_providers", {
  code: text("code").primaryKey(),
  displayName: text("display_name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("commercial_payment_providers_code_format", sql`${table.code} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("commercial_payment_providers_name_nonempty", sql`length(btrim(${table.displayName})) > 0`),
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
  provider: text("provider").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
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
  provider: text("provider").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
  providerCustomerRef: text("provider_customer_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "commercial_organization_payer_references_organization_fk", columns: [table.organizationId], foreignColumns: [organizations.id] }).onDelete("restrict"),
]);

export const commercialOffers = pgTable("commercial_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  partnerId: uuid("partner_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_offers_partner_code_unique").on(table.partnerId, table.code),
  foreignKey({ name: "commercial_offers_partner_fk", columns: [table.partnerId], foreignColumns: [commercialPartners.id] }).onDelete("restrict"),
  check("commercial_offers_code_nonempty", sql`length(btrim(${table.code})) > 0`),
  check("commercial_offers_name_nonempty", sql`length(btrim(${table.name})) > 0`),
]);

export const commercialOfferGrants = pgTable("commercial_offer_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  offerId: uuid("offer_id").notNull(),
  productId: uuid("product_id").notNull(),
  grantType: commercialOfferGrantType("grant_type").notNull(),
  durationDays: integer("duration_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_offer_grants_offer_product_type_unique").on(table.offerId, table.productId, table.grantType),
  foreignKey({ name: "commercial_offer_grants_offer_fk", columns: [table.offerId], foreignColumns: [commercialOffers.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_offer_grants_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  check("commercial_offer_grants_duration_valid", sql`(${table.grantType} = 'partner_benefit' AND (${table.durationDays} IS NULL OR ${table.durationDays} > 0)) OR (${table.grantType} = 'trial' AND ${table.durationDays} > 0)`),
]);

export const commercialPartnerInvites = pgTable("commercial_partner_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  offerId: uuid("offer_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxClaims: integer("max_claims"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_partner_invites_token_hash_unique").on(table.tokenHash),
  index("commercial_partner_invites_offer_idx").on(table.offerId),
  foreignKey({ name: "commercial_partner_invites_offer_fk", columns: [table.offerId], foreignColumns: [commercialOffers.id] }).onDelete("restrict"),
  check("commercial_partner_invites_token_hash_sha256", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("commercial_partner_invites_max_claims_positive", sql`${table.maxClaims} IS NULL OR ${table.maxClaims} > 0`),
  check("commercial_partner_invites_expiry_after_creation", sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`),
]);

export const commercialPartnerInviteClaims = pgTable("commercial_partner_invite_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull(),
  locationId: uuid("location_id").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_partner_invite_claims_invite_location_unique").on(table.inviteId, table.locationId),
  index("commercial_partner_invite_claims_location_idx").on(table.locationId),
  foreignKey({ name: "commercial_partner_invite_claims_invite_fk", columns: [table.inviteId], foreignColumns: [commercialPartnerInvites.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_partner_invite_claims_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
]);

export const commercialPaymentRoutes = pgTable("commercial_payment_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  marketCode: text("market_code").notNull(),
  productId: uuid("product_id").notNull(),
  providerCode: text("provider_code").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
  externalReference: text("external_reference").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "commercial_payment_routes_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  uniqueIndex("commercial_payment_routes_external_ref_unique").on(table.marketCode, table.productId, table.providerCode, table.externalReference),
  index("commercial_payment_routes_lookup_idx").on(table.marketCode, table.productId, table.isEnabled, table.displayOrder),
  check("commercial_payment_routes_market_format", sql`${table.marketCode} ~ '^[A-Z]{2}$'`),
  check("commercial_payment_routes_external_reference_nonempty", sql`length(btrim(${table.externalReference})) > 0`),
  check("commercial_payment_routes_display_order_nonnegative", sql`${table.displayOrder} >= 0`),
]);

export const commercialPayments = pgTable("commercial_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull(),
  productId: uuid("product_id").notNull(),
  subscriptionId: uuid("subscription_id"),
  routeId: uuid("route_id"),
  providerCode: text("provider_code").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
  // paymentKey is a stable provider-scoped transaction identity. Adapters can
  // use a provider payment ID or another documented stable transaction key.
  paymentKey: text("payment_key").notNull(),
  externalPaymentId: text("external_payment_id"),
  externalSubscriptionRef: text("external_subscription_ref"),
  status: text("status").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: text("currency").notNull(),
  providerOccurredAt: timestamp("provider_occurred_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "commercial_payments_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_payments_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_payments_subscription_fk", columns: [table.subscriptionId], foreignColumns: [locationSubscriptions.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_payments_route_fk", columns: [table.routeId], foreignColumns: [commercialPaymentRoutes.id] }).onDelete("restrict"),
  uniqueIndex("commercial_payments_provider_key_unique").on(table.providerCode, table.paymentKey),
  uniqueIndex("commercial_payments_provider_external_id_unique").on(table.providerCode, table.externalPaymentId).where(sql`${table.externalPaymentId} IS NOT NULL`),
  index("commercial_payments_location_created_idx").on(table.locationId, table.createdAt),
  check("commercial_payments_key_nonempty", sql`length(btrim(${table.paymentKey})) > 0`),
  check("commercial_payments_status_valid", sql`${table.status} IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded')`),
  check("commercial_payments_amount_nonnegative", sql`${table.amountMinor} >= 0`),
  check("commercial_payments_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
]);

export const commercialPaymentEvents = pgTable("commercial_payment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerCode: text("provider_code").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").references(() => commercialPayments.id, { onDelete: "restrict" }),
  externalEventId: text("external_event_id"),
  paymentKey: text("payment_key").notNull(),
  // Required stable dedupe identity supplied by a provider adapter; it need not
  // be the provider's external event ID when that provider has none.
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_payment_events_provider_key_unique").on(table.providerCode, table.idempotencyKey),
  uniqueIndex("commercial_payment_events_provider_external_id_unique").on(table.providerCode, table.externalEventId).where(sql`${table.externalEventId} IS NOT NULL`),
  index("commercial_payment_events_payment_idx").on(table.paymentId),
  check("commercial_payment_events_key_nonempty", sql`length(btrim(${table.idempotencyKey})) > 0`),
  check("commercial_payment_events_payment_key_nonempty", sql`length(btrim(${table.paymentKey})) > 0`),
  check("commercial_payment_events_status_valid", sql`${table.status} IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded')`),
]);
