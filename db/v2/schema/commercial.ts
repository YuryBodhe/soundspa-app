import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commercialOfferGrantType, commercialProductKind, commercialSubscriptionStatus, commercialTrialStatus } from "./enums";
import { organizations } from "./core/organizations";
import { users } from "./core/users";
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

export type BillingResetAffectedRecords = {
  subscriptions: string[];
  trials: string[];
  ordersCanceled: string[];
  paymentsCanceled: string[];
  legacyLocationAccess: { trialEndsAt: string | null; paidThrough: string | null } | null;
};

/** Durable operator audit record for a staging billing reset. */
export const commercialBillingResets = pgTable("commercial_billing_resets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").notNull().references(() => locations.id, { onDelete: "restrict" }),
  productIds: uuid("product_ids").array().notNull(),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  trialDurationDays: integer("trial_duration_days").notNull(),
  affectedRecords: jsonb("affected_records").$type<BillingResetAffectedRecords>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("commercial_billing_resets_location_created_idx").on(table.locationId, table.createdAt),
  check("commercial_billing_resets_operator_nonempty", sql`length(btrim(${table.operator})) > 0`),
  check("commercial_billing_resets_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 12 AND 500`),
  check("commercial_billing_resets_trial_duration", sql`${table.trialDurationDays} BETWEEN 1 AND 365`),
  check("commercial_billing_resets_products_nonempty", sql`cardinality(${table.productIds}) > 0`),
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
  invalidatedByResetId: uuid("invalidated_by_reset_id").references(() => commercialBillingResets.id, { onDelete: "restrict" }),
}, (table) => [
  uniqueIndex("location_core_trials_location_product_unique").on(table.locationId, table.productId).where(sql`${table.invalidatedByResetId} IS NULL`),
  index("location_core_trials_reset_idx").on(table.invalidatedByResetId),
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
  // Nullable for historical/provider-managed subscriptions. New prepaid
  // orders persist the original UTC month anchor to avoid renewal drift.
  billingAnchorDay: integer("billing_anchor_day"),
  billingAnchorIsEndOfMonth: boolean("billing_anchor_is_end_of_month"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  priceMinor: integer("price_minor"),
  currency: text("currency"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  invalidatedByResetId: uuid("invalidated_by_reset_id").references(() => commercialBillingResets.id, { onDelete: "restrict" }),
}, (table) => [
  uniqueIndex("location_subscriptions_provider_ref_unique").on(table.provider, table.providerSubscriptionRef),
  foreignKey({ name: "location_subscriptions_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
  foreignKey({ name: "location_subscriptions_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  check("location_subscriptions_price_pair", sql`(${table.priceMinor} IS NULL AND ${table.currency} IS NULL) OR (${table.priceMinor} >= 0 AND ${table.currency} IS NOT NULL AND length(btrim(${table.currency})) = 3)`),
  check("location_subscriptions_period_after_start", sql`${table.currentPeriodEndsAt} IS NULL OR ${table.currentPeriodEndsAt} > ${table.startsAt}`),
  check("location_subscriptions_billing_anchor_pair", sql`(${table.billingAnchorDay} IS NULL AND ${table.billingAnchorIsEndOfMonth} IS NULL) OR (${table.billingAnchorDay} BETWEEN 1 AND 31 AND ${table.billingAnchorIsEndOfMonth} IS NOT NULL)`),
  index("location_subscriptions_reset_idx").on(table.invalidatedByResetId),
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
  uniqueIndex("commercial_payment_routes_id_product_market_provider_unique").on(table.id, table.productId, table.marketCode, table.providerCode),
  index("commercial_payment_routes_lookup_idx").on(table.marketCode, table.productId, table.isEnabled, table.displayOrder),
  check("commercial_payment_routes_market_format", sql`${table.marketCode} ~ '^[A-Z]{2}$'`),
  check("commercial_payment_routes_external_reference_nonempty", sql`length(btrim(${table.externalReference})) > 0`),
  check("commercial_payment_routes_display_order_nonnegative", sql`${table.displayOrder} >= 0`),
]);

/** Provider-independent, immutable-at-quote billing snapshot for one Organization. */
export const commercialBillingOrders = pgTable("commercial_billing_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("draft"),
  providerCode: text("provider_code").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
  currency: text("currency").notNull(),
  totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull(),
  quoteReference: text("quote_reference"),
  quotedAt: timestamp("quoted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  providerOrderReference: text("provider_order_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_billing_orders_id_organization_unique").on(table.id, table.organizationId),
  uniqueIndex("commercial_billing_orders_id_provider_unique").on(table.id, table.providerCode),
  uniqueIndex("commercial_billing_orders_id_currency_unique").on(table.id, table.currency),
  index("commercial_billing_orders_organization_created_idx").on(table.organizationId, table.createdAt),
  check("commercial_billing_orders_status_valid", sql`${table.status} IN ('draft', 'quoted', 'pending', 'paid', 'expired', 'canceled', 'failed')`),
  check("commercial_billing_orders_amount_nonnegative", sql`${table.totalAmountMinor} >= 0`),
  check("commercial_billing_orders_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("commercial_billing_orders_quote_expiry", sql`${table.expiresAt} IS NULL OR (${table.quotedAt} IS NOT NULL AND ${table.expiresAt} > ${table.quotedAt})`),
]);

/** Each line is one Location/Product entitlement purchase with a frozen route and amount. */
export const commercialBillingOrderLines = pgTable("commercial_billing_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  locationId: uuid("location_id").notNull(),
  productId: uuid("product_id").notNull().references(() => commercialProducts.id, { onDelete: "restrict" }),
  providerCode: text("provider_code").notNull(),
  currency: text("currency").notNull(),
  marketCode: text("market_code").notNull(),
  routeId: uuid("route_id").notNull(),
  routeExternalReference: text("route_external_reference").notNull(),
  durationMonths: integer("duration_months").notNull(),
  listAmountMinor: bigint("list_amount_minor", { mode: "bigint" }).notNull(),
  discountAmountMinor: bigint("discount_amount_minor", { mode: "bigint" }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  billingAnchorDay: integer("billing_anchor_day").notNull(),
  billingAnchorIsEndOfMonth: boolean("billing_anchor_is_end_of_month").notNull(),
  billingPeriodStartsAt: timestamp("billing_period_starts_at", { withTimezone: true }),
  billingPeriodEndsAt: timestamp("billing_period_ends_at", { withTimezone: true }),
  subscriptionId: uuid("subscription_id").references(() => locationSubscriptions.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_billing_order_lines_id_order_unique").on(table.id, table.orderId),
  uniqueIndex("commercial_billing_order_lines_target_unique").on(table.orderId, table.locationId, table.productId),
  foreignKey({ name: "commercial_billing_order_lines_order_organization_fk", columns: [table.orderId, table.organizationId], foreignColumns: [commercialBillingOrders.id, commercialBillingOrders.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_billing_order_lines_location_organization_fk", columns: [table.locationId, table.organizationId], foreignColumns: [locations.id, locations.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_billing_order_lines_order_provider_fk", columns: [table.orderId, table.providerCode], foreignColumns: [commercialBillingOrders.id, commercialBillingOrders.providerCode] }).onDelete("restrict"),
  foreignKey({ name: "commercial_billing_order_lines_order_currency_fk", columns: [table.orderId, table.currency], foreignColumns: [commercialBillingOrders.id, commercialBillingOrders.currency] }).onDelete("restrict"),
  foreignKey({ name: "commercial_billing_order_lines_route_snapshot_fk", columns: [table.routeId, table.productId, table.marketCode, table.providerCode], foreignColumns: [commercialPaymentRoutes.id, commercialPaymentRoutes.productId, commercialPaymentRoutes.marketCode, commercialPaymentRoutes.providerCode] }).onDelete("restrict"),
  check("commercial_billing_order_lines_duration_months", sql`${table.durationMonths} BETWEEN 1 AND 12`),
  check("commercial_billing_order_lines_market_format", sql`${table.marketCode} ~ '^[A-Z]{2}$'`),
  check("commercial_billing_order_lines_route_reference_nonempty", sql`length(btrim(${table.routeExternalReference})) > 0`),
  check("commercial_billing_order_lines_amounts", sql`${table.listAmountMinor} >= 0 AND ${table.discountAmountMinor} >= 0 AND ${table.discountAmountMinor} <= ${table.listAmountMinor} AND ${table.amountMinor} = ${table.listAmountMinor} - ${table.discountAmountMinor}`),
  check("commercial_billing_order_lines_anchor_day", sql`${table.billingAnchorDay} BETWEEN 1 AND 31`),
  check("commercial_billing_order_lines_period_pair", sql`(${table.billingPeriodStartsAt} IS NULL AND ${table.billingPeriodEndsAt} IS NULL) OR (${table.billingPeriodStartsAt} IS NOT NULL AND ${table.billingPeriodEndsAt} > ${table.billingPeriodStartsAt})`),
  index("commercial_billing_order_lines_location_product_idx").on(table.locationId, table.productId),
]);

export const commercialPayments = pgTable("commercial_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Existing payments remain Location/Product scoped. Aggregate order payments
  // use billingOrderId and leave those legacy scope columns null.
  locationId: uuid("location_id"),
  productId: uuid("product_id"),
  billingOrderId: uuid("billing_order_id"),
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
  foreignKey({ name: "commercial_payments_billing_order_fk", columns: [table.billingOrderId], foreignColumns: [commercialBillingOrders.id] }).onDelete("restrict"),
  foreignKey({ name: "commercial_payments_order_provider_fk", columns: [table.billingOrderId, table.providerCode], foreignColumns: [commercialBillingOrders.id, commercialBillingOrders.providerCode] }).onDelete("restrict"),
  foreignKey({ name: "commercial_payments_order_currency_fk", columns: [table.billingOrderId, table.currency], foreignColumns: [commercialBillingOrders.id, commercialBillingOrders.currency] }).onDelete("restrict"),
  uniqueIndex("commercial_payments_id_billing_order_unique").on(table.id, table.billingOrderId),
  uniqueIndex("commercial_payments_billing_order_unique").on(table.billingOrderId).where(sql`${table.billingOrderId} IS NOT NULL`),
  uniqueIndex("commercial_payments_provider_key_unique").on(table.providerCode, table.paymentKey),
  uniqueIndex("commercial_payments_provider_external_id_unique").on(table.providerCode, table.externalPaymentId).where(sql`${table.externalPaymentId} IS NOT NULL`),
  index("commercial_payments_location_created_idx").on(table.locationId, table.createdAt),
  check("commercial_payments_key_nonempty", sql`length(btrim(${table.paymentKey})) > 0`),
  check("commercial_payments_status_valid", sql`${table.status} IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded')`),
  check("commercial_payments_amount_nonnegative", sql`${table.amountMinor} >= 0`),
  check("commercial_payments_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("commercial_payments_scope_shape", sql`(${table.billingOrderId} IS NULL AND ${table.locationId} IS NOT NULL AND ${table.productId} IS NOT NULL) OR (${table.billingOrderId} IS NOT NULL AND ${table.locationId} IS NULL AND ${table.productId} IS NULL AND ${table.subscriptionId} IS NULL AND ${table.routeId} IS NULL)`),
]);

/** Exact per-line allocation of one aggregate provider payment. */
export const commercialPaymentAllocations = pgTable("commercial_payment_allocations", {
  orderId: uuid("order_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  orderLineId: uuid("order_line_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.paymentId, table.orderLineId] }),
  uniqueIndex("commercial_payment_allocations_order_line_unique").on(table.orderLineId),
  foreignKey({ name: "commercial_payment_allocations_payment_order_fk", columns: [table.paymentId, table.orderId], foreignColumns: [commercialPayments.id, commercialPayments.billingOrderId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_payment_allocations_line_order_fk", columns: [table.orderLineId, table.orderId], foreignColumns: [commercialBillingOrderLines.id, commercialBillingOrderLines.orderId] }).onDelete("restrict"),
  check("commercial_payment_allocations_amount_nonnegative", sql`${table.amountMinor} >= 0`),
  index("commercial_payment_allocations_order_idx").on(table.orderId),
]);

export const commercialPaymentEvents = pgTable("commercial_payment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerCode: text("provider_code").notNull().references(() => commercialPaymentProviders.code, { onDelete: "restrict" }),
  // Null for trusted subscription lifecycle events that do not represent a charge.
  paymentId: uuid("payment_id").references(() => commercialPayments.id, { onDelete: "restrict" }),
  externalEventId: text("external_event_id"),
  // Stable payment identity, or a namespaced subject/payload identity for a non-payment lifecycle event.
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
