import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { locations } from "./core/locations";
import { users } from "./core/users";

/**
 * Non-binding customer preparation data only. A Gift draft is not an agreement,
 * eligibility review, commercial entitlement, Partner Benefit, or Device grant.
 */
export const commercialSpaquatoriaGiftDrafts = pgTable("commercial_spaquatoria_gift_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  locationId: uuid("location_id").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  legalForm: text("legal_form").$type<"ru_legal_entity" | "ru_individual_entrepreneur">(),
  legalName: text("legal_name"),
  taxId: text("tax_id"),
  registrationNumber: text("registration_number"),
  registeredAddress: text("registered_address"),
  physicalAddress: text("physical_address"),
  normalizedPhysicalAddress: text("normalized_physical_address"),
  representativeName: text("representative_name"),
  representativeRole: text("representative_role"),
  representativeEmail: text("representative_email"),
  representativePhone: text("representative_phone"),
  /** Free-form preparatory statement; this is explicitly not legal acceptance. */
  authorityStatement: text("authority_statement"),
  status: text("status").$type<"draft">().notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_spaquatoria_gift_drafts_location_unique").on(table.locationId),
  uniqueIndex("commercial_spaquatoria_gift_drafts_id_scope_unique").on(table.id, table.organizationId, table.locationId),
  index("commercial_spaquatoria_gift_drafts_org_updated_idx").on(table.organizationId, table.updatedAt),
  foreignKey({ name: "commercial_spaquatoria_gift_drafts_location_org_fk", columns: [table.locationId, table.organizationId], foreignColumns: [locations.id, locations.organizationId] }).onDelete("restrict"),
  check("commercial_spaquatoria_gift_drafts_status_valid", sql`${table.status} = 'draft'`),
  check("commercial_spaquatoria_gift_drafts_version_positive", sql`${table.version} > 0`),
  check("commercial_spaquatoria_gift_drafts_form_valid", sql`${table.legalForm} IS NULL OR ${table.legalForm} IN ('ru_legal_entity','ru_individual_entrepreneur')`),
  check("commercial_spaquatoria_gift_drafts_legal_name_length", sql`${table.legalName} IS NULL OR length(btrim(${table.legalName})) BETWEEN 1 AND 300`),
  check("commercial_spaquatoria_gift_drafts_tax_id_shape", sql`${table.taxId} IS NULL OR ${table.taxId} ~ '^[0-9]{1,12}$'`),
  check("commercial_spaquatoria_gift_drafts_registration_shape", sql`${table.registrationNumber} IS NULL OR ${table.registrationNumber} ~ '^[0-9]{1,15}$'`),
  check("commercial_spaquatoria_gift_drafts_registered_address_length", sql`${table.registeredAddress} IS NULL OR length(btrim(${table.registeredAddress})) BETWEEN 1 AND 1000`),
  check("commercial_spaquatoria_gift_drafts_physical_address_pair", sql`(${table.physicalAddress} IS NULL AND ${table.normalizedPhysicalAddress} IS NULL) OR (${table.physicalAddress} IS NOT NULL AND length(btrim(${table.physicalAddress})) BETWEEN 1 AND 1000 AND ${table.normalizedPhysicalAddress} IS NOT NULL AND length(btrim(${table.normalizedPhysicalAddress})) BETWEEN 1 AND 1200)`),
  check("commercial_spaquatoria_gift_drafts_representative_name_length", sql`${table.representativeName} IS NULL OR length(btrim(${table.representativeName})) BETWEEN 1 AND 300`),
  check("commercial_spaquatoria_gift_drafts_representative_role_length", sql`${table.representativeRole} IS NULL OR length(btrim(${table.representativeRole})) BETWEEN 1 AND 200`),
  check("commercial_spaquatoria_gift_drafts_representative_email_shape", sql`${table.representativeEmail} IS NULL OR ${table.representativeEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`),
  check("commercial_spaquatoria_gift_drafts_representative_phone_length", sql`${table.representativePhone} IS NULL OR length(btrim(${table.representativePhone})) BETWEEN 1 AND 64`),
  check("commercial_spaquatoria_gift_drafts_authority_statement_length", sql`${table.authorityStatement} IS NULL OR length(btrim(${table.authorityStatement})) BETWEEN 1 AND 1000`),
]);
