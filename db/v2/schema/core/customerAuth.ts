import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { locations } from "./locations";
import { organizations } from "./organizations";
import { commercialProducts } from "../commercialProducts";

export type LegacyDivnitsaRegistrationLinkPolicySnapshot = {
  policyKey: "divnitsa";
  policyVersion: 1;
  basicProductId: string;
  divnitsaProductId: string;
  basicTrialDays: 30;
  divnitsaTrialDays: 30;
};

export type UniversalRegistrationLinkProduct = {
  productId: string;
  productCode: "soundspa" | "divnitsa" | "spaquatoria";
  productName: string;
  accessType: "trial" | "partner_benefit";
  durationMonths: number;
  partnerId?: string;
};

export type UniversalRegistrationLinkPolicySnapshot = {
  policyKey: "universal";
  policyVersion: 1;
  products: UniversalRegistrationLinkProduct[];
};

export type RegistrationLinkPolicySnapshot = LegacyDivnitsaRegistrationLinkPolicySnapshot | UniversalRegistrationLinkPolicySnapshot;

export type RegistrationLinkAuditState = {
  policyKey: "divnitsa" | "universal";
  policyVersion: 1;
  products?: UniversalRegistrationLinkProduct[];
  expiresAt: string | null;
  maxRedemptions: number | null;
  disabledAt: string | null;
};

export const commercialRegistrationLinks = pgTable("commercial_registration_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull(),
  policyKey: text("policy_key").notNull(),
  policyVersion: integer("policy_version").notNull(),
  policySnapshot: jsonb("policy_snapshot").$type<RegistrationLinkPolicySnapshot>().notNull(),
  createdByOperator: text("created_by_operator").notNull(),
  creationReason: text("creation_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxRedemptions: integer("max_redemptions"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledByOperator: text("disabled_by_operator"),
  disableReason: text("disable_reason"),
}, (table) => [
  uniqueIndex("commercial_registration_links_token_hash_unique").on(table.tokenHash),
  index("commercial_registration_links_status_idx").on(table.createdAt, table.expiresAt, table.disabledAt),
  check("commercial_registration_links_token_hash_sha256", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("commercial_registration_links_policy_valid", sql`jsonb_typeof(${table.policySnapshot}) = 'object' AND ${table.policySnapshot}->>'policyKey' = ${table.policyKey} AND ${table.policySnapshot}->>'policyVersion' = ${table.policyVersion}::text AND ((${table.policyKey} = 'divnitsa' AND ${table.policyVersion} = 1 AND ${table.policySnapshot}->>'basicProductId' ~ '^[0-9a-f-]{36}$' AND ${table.policySnapshot}->>'divnitsaProductId' ~ '^[0-9a-f-]{36}$' AND ${table.policySnapshot}->>'basicTrialDays' = '30' AND ${table.policySnapshot}->>'divnitsaTrialDays' = '30') OR (${table.policyKey} = 'universal' AND ${table.policyVersion} = 1 AND jsonb_typeof(${table.policySnapshot}->'products') = 'array' AND jsonb_array_length(${table.policySnapshot}->'products') BETWEEN 1 AND 3))`),
  check("commercial_registration_links_operator_nonempty", sql`length(btrim(${table.createdByOperator})) > 0`),
  check("commercial_registration_links_reason_nonempty", sql`length(btrim(${table.creationReason})) BETWEEN 1 AND 500`),
  check("commercial_registration_links_max_redemptions_positive", sql`${table.maxRedemptions} IS NULL OR ${table.maxRedemptions} > 0`),
  check("commercial_registration_links_expiry_after_creation", sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`),
  check("commercial_registration_links_disabled_after_creation", sql`${table.disabledAt} IS NULL OR ${table.disabledAt} >= ${table.createdAt}`),
  check("commercial_registration_links_disable_shape", sql`(${table.disabledAt} IS NULL AND ${table.disabledByOperator} IS NULL AND ${table.disableReason} IS NULL) OR (${table.disabledAt} IS NOT NULL AND ${table.disabledByOperator} IS NOT NULL AND length(btrim(${table.disabledByOperator})) > 0 AND ${table.disableReason} IS NOT NULL AND length(btrim(${table.disableReason})) BETWEEN 12 AND 500)`),
]);

export const customerSignupIntents = pgTable("customer_signup_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email"),
  locale: text("locale").notNull().default("en"),
  inviteTokenHash: text("invite_token_hash"),
  contextTokenHash: text("context_token_hash"),
  registrationLinkId: uuid("registration_link_id").references(() => commercialRegistrationLinks.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("customer_signup_intents_locale_supported", sql`${table.locale} IN ('en', 'ru', 'vi', 'th')`),
  check("customer_signup_intents_email_normalized", sql`${table.email} IS NULL OR (${table.email} = lower(btrim(${table.email})) AND length(${table.email}) > 0)`),
  check("customer_signup_intents_invite_hash_sha256", sql`${table.inviteTokenHash} IS NULL OR ${table.inviteTokenHash} ~ '^[0-9a-f]{64}$'`),
  check("customer_signup_intents_context_hash_sha256", sql`${table.contextTokenHash} IS NULL OR ${table.contextTokenHash} ~ '^[0-9a-f]{64}$'`),
  check("customer_signup_intents_invite_registration_exclusive", sql`${table.inviteTokenHash} IS NULL OR ${table.registrationLinkId} IS NULL`),
  uniqueIndex("customer_signup_intents_context_token_hash_unique").on(table.contextTokenHash),
  uniqueIndex("customer_signup_intents_id_registration_link_unique").on(table.id, table.registrationLinkId),
  index("customer_signup_intents_email_idx").on(table.email),
]);

export const commercialRegistrationLinkRedemptions = pgTable("commercial_registration_link_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  registrationLinkId: uuid("registration_link_id").notNull().references(() => commercialRegistrationLinks.id, { onDelete: "restrict" }),
  signupIntentId: uuid("signup_intent_id").notNull().references(() => customerSignupIntents.id, { onDelete: "restrict" }),
  verifiedUserId: uuid("verified_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  firstLocationId: uuid("first_location_id").notNull(),
  productId: uuid("product_id").references(() => commercialProducts.id, { onDelete: "restrict" }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "commercial_registration_link_redemptions_location_org_fk", columns: [table.firstLocationId, table.organizationId], foreignColumns: [locations.id, locations.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_registration_link_redemptions_intent_link_fk", columns: [table.signupIntentId, table.registrationLinkId], foreignColumns: [customerSignupIntents.id, customerSignupIntents.registrationLinkId] }).onDelete("restrict"),
  uniqueIndex("commercial_registration_link_redemptions_intent_unique").on(table.signupIntentId),
  uniqueIndex("commercial_registration_link_redemptions_user_link_unique").on(table.registrationLinkId, table.verifiedUserId),
  uniqueIndex("commercial_registration_link_redemptions_id_org_product_unique").on(table.id, table.organizationId, table.productId),
  uniqueIndex("commercial_registration_link_redemptions_id_org_location_unique").on(table.id, table.organizationId, table.firstLocationId),
  index("commercial_registration_link_redemptions_link_time_idx").on(table.registrationLinkId, table.redeemedAt),
  index("commercial_registration_link_redemptions_org_idx").on(table.organizationId),
]);

/** Immutable per-Product access granted by a universal Registration Link redemption. */
export const commercialRegistrationLinkGrants = pgTable("commercial_registration_link_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  redemptionId: uuid("redemption_id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  locationId: uuid("location_id").notNull(),
  productId: uuid("product_id").notNull().references(() => commercialProducts.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id"),
  accessType: text("access_type").$type<"trial" | "partner_benefit">().notNull(),
  durationMonths: integer("duration_months").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_registration_link_grants_redemption_product_unique").on(table.redemptionId, table.productId),
  uniqueIndex("commercial_registration_link_grants_id_product_location_unique").on(table.id, table.productId, table.locationId),
  uniqueIndex("commercial_registration_link_grants_id_partner_product_location_unique").on(table.id, table.partnerId, table.productId, table.locationId),
  index("commercial_registration_link_grants_org_location_idx").on(table.organizationId, table.locationId),
  foreignKey({ name: "commercial_registration_link_grants_redemption_scope_fk", columns: [table.redemptionId, table.organizationId, table.locationId], foreignColumns: [commercialRegistrationLinkRedemptions.id, commercialRegistrationLinkRedemptions.organizationId, commercialRegistrationLinkRedemptions.firstLocationId] }).onDelete("restrict"),
  check("commercial_registration_link_grants_access_type_valid", sql`${table.accessType} IN ('trial', 'partner_benefit')`),
  check("commercial_registration_link_grants_partner_access_shape", sql`(${table.accessType} = 'trial' AND ${table.partnerId} IS NULL) OR (${table.accessType} = 'partner_benefit' AND ${table.partnerId} IS NOT NULL)`),
  check("commercial_registration_link_grants_duration_valid", sql`${table.durationMonths} BETWEEN 1 AND 12`),
  check("commercial_registration_link_grants_window", sql`${table.endsAt} > ${table.startsAt}`),
]);

export const commercialRegistrationLinkEvents = pgTable("commercial_registration_link_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  registrationLinkId: uuid("registration_link_id").notNull().references(() => commercialRegistrationLinks.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  beforeState: jsonb("before_state").$type<RegistrationLinkAuditState | null>(),
  afterState: jsonb("after_state").$type<RegistrationLinkAuditState>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("commercial_registration_link_events_link_time_idx").on(table.registrationLinkId, table.createdAt),
  uniqueIndex("commercial_registration_link_events_created_unique").on(table.registrationLinkId).where(sql`${table.action} = 'created'`),
  uniqueIndex("commercial_registration_link_events_disabled_unique").on(table.registrationLinkId).where(sql`${table.action} = 'disabled'`),
  check("commercial_registration_link_events_action_valid", sql`${table.action} IN ('created', 'disabled')`),
  check("commercial_registration_link_events_operator_nonempty", sql`length(btrim(${table.operator})) > 0`),
  check("commercial_registration_link_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
  check("commercial_registration_link_events_state_shape", sql`jsonb_typeof(${table.afterState}) = 'object' AND (${table.beforeState} IS NULL OR jsonb_typeof(${table.beforeState}) = 'object') AND ((${table.action} = 'created' AND ${table.beforeState} IS NULL AND ${table.afterState}->>'disabledAt' IS NULL) OR (${table.action} = 'disabled' AND ${table.beforeState} IS NOT NULL AND ${table.beforeState}->>'disabledAt' IS NULL AND ${table.afterState}->>'disabledAt' IS NOT NULL))`),
]);

export const customerAuthTokens = pgTable("customer_auth_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull(),
  purpose: text("purpose").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  signupIntentId: uuid("signup_intent_id").references(() => customerSignupIntents.id, { onDelete: "cascade" }),
  locale: text("locale").notNull().default("en"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("customer_auth_tokens_hash_sha256", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("customer_auth_tokens_purpose_valid", sql`${table.purpose} IN ('verify_email', 'login_link')`),
  check("customer_auth_tokens_target_valid", sql`(${table.purpose} = 'verify_email' AND ${table.signupIntentId} IS NOT NULL) OR (${table.purpose} = 'login_link' AND ${table.userId} IS NOT NULL)`),
  check("customer_auth_tokens_locale_supported", sql`${table.locale} IN ('en', 'ru', 'vi', 'th')`),
  uniqueIndex("customer_auth_tokens_token_hash_unique").on(table.tokenHash),
  index("customer_auth_tokens_user_idx").on(table.userId),
  index("customer_auth_tokens_intent_idx").on(table.signupIntentId),
]);

export const customerSessions = pgTable("customer_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signupIntentId: uuid("signup_intent_id").references(() => customerSignupIntents.id, { onDelete: "set null" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  check("customer_sessions_hash_sha256", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex("customer_sessions_token_hash_unique").on(table.tokenHash),
  index("customer_sessions_user_idx").on(table.userId),
]);
