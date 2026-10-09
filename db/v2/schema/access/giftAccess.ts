import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { giftAccessDuration } from "../enums";
import { organizations } from "../core/organizations";
import { users } from "../core/users";
import { channels } from "../product/channels";

/** Opaque invitation codes are stored only as SHA-256 hashes. */
export const giftAccessInvitations = pgTable("gift_access_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  duration: giftAccessDuration("duration").notNull(),
  durationMonths: integer("duration_months"),
  redemptionDeadline: timestamp("redemption_deadline", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByOperator: text("revoked_by_operator"),
  createdByOperator: text("created_by_operator").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedOrganizationId: uuid("redeemed_organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("gift_access_invitations_token_hash_unique").on(table.tokenHash),
  uniqueIndex("gift_access_invitations_redemption_target_unique").on(table.id, table.channelId, table.redeemedOrganizationId, table.redeemedByUserId),
  index("gift_access_invitations_created_idx").on(table.createdAt, table.id),
  index("gift_access_invitations_channel_idx").on(table.channelId),
  check("gift_access_invitations_token_hash_sha256", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("gift_access_invitations_operator_nonempty", sql`length(btrim(${table.createdByOperator})) > 0`),
  check("gift_access_invitations_revocation_shape", sql`(${table.revokedAt} IS NULL AND ${table.revokedByOperator} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByOperator} IS NOT NULL AND length(btrim(${table.revokedByOperator})) > 0)`),
  check("gift_access_invitations_duration_shape", sql`(${table.duration} = 'indefinite' AND ${table.durationMonths} IS NULL) OR (${table.duration} <> 'indefinite' AND ${table.durationMonths} IN (3, 6, 12))`),
  check("gift_access_invitations_redemption_shape", sql`(${table.redeemedAt} IS NULL AND ${table.redeemedOrganizationId} IS NULL AND ${table.redeemedByUserId} IS NULL) OR (${table.redeemedAt} IS NOT NULL AND ${table.redeemedOrganizationId} IS NOT NULL AND ${table.redeemedByUserId} IS NOT NULL)`),
]);

/** One durable record per redeemed invitation, kept separate from other access sources. */
export const organizationChannelGiftGrants = pgTable("organization_channel_gift_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  invitationId: uuid("invitation_id").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  redeemedByUserId: uuid("redeemed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  duration: giftAccessDuration("duration").notNull(),
  durationMonths: integer("duration_months"),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  billingAnchorDay: integer("billing_anchor_day"),
  billingAnchorIsEndOfMonth: boolean("billing_anchor_is_end_of_month"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByOperator: text("revoked_by_operator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("organization_channel_gift_grants_invitation_unique").on(table.invitationId),
  foreignKey({ name: "organization_channel_gift_grants_invitation_target_fk", columns: [table.invitationId, table.channelId, table.organizationId, table.redeemedByUserId], foreignColumns: [giftAccessInvitations.id, giftAccessInvitations.channelId, giftAccessInvitations.redeemedOrganizationId, giftAccessInvitations.redeemedByUserId] }).onDelete("restrict"),
  index("organization_channel_gift_grants_entitlement_idx").on(table.organizationId, table.channelId, table.revokedAt, table.startsAt, table.endsAt),
  index("organization_channel_gift_grants_redemption_idx").on(table.organizationId, table.channelId, table.redeemedAt, table.id),
  check("organization_channel_gift_grants_duration_shape", sql`(${table.duration} = 'indefinite' AND ${table.durationMonths} IS NULL AND ${table.endsAt} IS NULL AND ${table.billingAnchorDay} IS NULL AND ${table.billingAnchorIsEndOfMonth} IS NULL) OR (${table.duration} <> 'indefinite' AND ${table.durationMonths} IN (3, 6, 12) AND ${table.endsAt} > ${table.startsAt} AND ${table.billingAnchorDay} BETWEEN 1 AND 31 AND ${table.billingAnchorIsEndOfMonth} IS NOT NULL)`),
  check("organization_channel_gift_grants_revocation_shape", sql`(${table.revokedAt} IS NULL AND ${table.revokedByOperator} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByOperator} IS NOT NULL AND length(btrim(${table.revokedByOperator})) > 0)`),
]);
