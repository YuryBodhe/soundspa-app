import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgSchema, timestamp, uniqueIndex, uuid, text } from "drizzle-orm/pg-core";
import { commercialProducts } from "./commercialProducts";
import { locations } from "./core/locations";
import { commercialRegistrationLinkGrants } from "./core/customerAuth";
import { commercialPartnerInviteClaims } from "./commercial";

export const commercialPromotionalAccessSchema = pgSchema("commercial_promotional_access");

/** Location + Product promotional entitlement history, independent of trials and partner benefits. */
export const locationProductPromotionalAccess = commercialPromotionalAccessSchema.table("location_product_promotional_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id").notNull(),
  productId: uuid("product_id").notNull(),
  source: text("source").$type<"operator" | "registration_link" | "partner_invite">().notNull(),
  registrationLinkGrantId: uuid("registration_link_grant_id"),
  partnerInviteClaimId: uuid("partner_invite_claim_id"),
  durationUnit: text("duration_unit").$type<"calendar_months" | "days">().notNull(),
  durationValue: integer("duration_value").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").$type<"granted" | "revoked">().notNull().default("granted"),
  grantedByOperator: text("granted_by_operator"),
  reasonCode: text("reason_code").notNull(),
  reason: text("reason").notNull(),
  operatorRequestId: uuid("operator_request_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByOperator: text("revoked_by_operator"),
  revokeReason: text("revoke_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "location_product_promotional_access_location_fk", columns: [table.locationId], foreignColumns: [locations.id] }).onDelete("restrict"),
  foreignKey({ name: "location_product_promotional_access_product_fk", columns: [table.productId], foreignColumns: [commercialProducts.id] }).onDelete("restrict"),
  foreignKey({ name: "location_product_promotional_access_registration_grant_fk", columns: [table.registrationLinkGrantId, table.productId, table.locationId], foreignColumns: [commercialRegistrationLinkGrants.id, commercialRegistrationLinkGrants.productId, commercialRegistrationLinkGrants.locationId] }).onDelete("restrict"),
  foreignKey({ name: "location_product_promotional_access_partner_claim_fk", columns: [table.partnerInviteClaimId, table.locationId], foreignColumns: [commercialPartnerInviteClaims.id, commercialPartnerInviteClaims.locationId] }).onDelete("restrict"),
  check("location_product_promotional_access_source_shape", sql`
    (${table.source} = 'operator' AND ${table.registrationLinkGrantId} IS NULL AND ${table.partnerInviteClaimId} IS NULL AND ${table.grantedByOperator} IS NOT NULL AND length(btrim(${table.grantedByOperator})) > 0 AND ${table.operatorRequestId} IS NOT NULL AND ${table.reasonCode} IN ('testing','partner_offer','compensation','other')) OR
    (${table.source} = 'registration_link' AND ${table.registrationLinkGrantId} IS NOT NULL AND ${table.partnerInviteClaimId} IS NULL AND ${table.grantedByOperator} IS NULL AND ${table.operatorRequestId} IS NULL AND ${table.reasonCode} = 'source_grant') OR
    (${table.source} = 'partner_invite' AND ${table.registrationLinkGrantId} IS NULL AND ${table.partnerInviteClaimId} IS NOT NULL AND ${table.grantedByOperator} IS NULL AND ${table.operatorRequestId} IS NULL AND ${table.reasonCode} = 'source_grant')`),
  check("location_product_promotional_access_duration_shape", sql`
    (${table.durationUnit} = 'calendar_months' AND ${table.durationValue} BETWEEN 1 AND 12) OR
    (${table.durationUnit} = 'days' AND ${table.durationValue} > 0)`),
  check("location_product_promotional_access_window", sql`${table.endsAt} > ${table.startsAt}`),
  check("location_product_promotional_access_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
  check("location_product_promotional_access_status_shape", sql`
    (${table.status} = 'granted' AND ${table.revokedAt} IS NULL AND ${table.revokedByOperator} IS NULL AND ${table.revokeReason} IS NULL) OR
    (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL AND ${table.revokedByOperator} IS NOT NULL AND length(btrim(${table.revokedByOperator})) > 0 AND ${table.revokeReason} IS NOT NULL AND length(btrim(${table.revokeReason})) BETWEEN 1 AND 500 AND ${table.revokedAt} >= ${table.grantedAt})`),
  uniqueIndex("location_product_promotional_access_registration_grant_unique").on(table.registrationLinkGrantId).where(sql`${table.registrationLinkGrantId} IS NOT NULL`),
  uniqueIndex("location_product_promotional_access_partner_claim_product_unique").on(table.partnerInviteClaimId, table.productId).where(sql`${table.partnerInviteClaimId} IS NOT NULL`),
  uniqueIndex("location_product_promotional_access_operator_request_unique").on(table.operatorRequestId).where(sql`${table.operatorRequestId} IS NOT NULL`),
  index("location_product_promotional_access_effective_idx").on(table.locationId, table.productId, table.status, table.startsAt, table.endsAt),
  index("location_product_promotional_access_history_idx").on(table.locationId, table.productId, table.grantedAt),
]);

/** Append-only record of grant, revocation and future scheduling decisions. */
export const locationProductPromotionalAccessEvents = commercialPromotionalAccessSchema.table("location_product_promotional_access_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  promotionalAccessId: uuid("promotional_access_id").notNull().references(() => locationProductPromotionalAccess.id, { onDelete: "restrict" }),
  action: text("action").$type<"granted" | "revoked">().notNull(),
  actorType: text("actor_type").$type<"operator" | "system">().notNull(),
  operator: text("operator"),
  reason: text("reason").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("location_product_promotional_access_events_action_unique").on(table.promotionalAccessId, table.action),
  index("location_product_promotional_access_events_time_idx").on(table.promotionalAccessId, table.occurredAt),
  check("location_product_promotional_access_events_action_valid", sql`${table.action} IN ('granted','revoked')`),
  check("location_product_promotional_access_events_actor_shape", sql`(${table.actorType} = 'operator' AND ${table.operator} IS NOT NULL AND length(btrim(${table.operator})) > 0) OR (${table.actorType} = 'system' AND ${table.operator} IS NULL)`),
  check("location_product_promotional_access_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
]);
