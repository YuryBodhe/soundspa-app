import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const customerSignupIntents = pgTable("customer_signup_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email"),
  locale: text("locale").notNull().default("en"),
  inviteTokenHash: text("invite_token_hash"),
  contextTokenHash: text("context_token_hash"),
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
  uniqueIndex("customer_signup_intents_context_token_hash_unique").on(table.contextTokenHash),
  index("customer_signup_intents_email_idx").on(table.email),
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
