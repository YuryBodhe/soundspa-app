import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { locations } from "./core/locations";
import { organizations } from "./core/organizations";
import { users } from "./core/users";
import { deviceProductAssignments } from "./monitoring/deviceProductAssignments";

/** One Russian legal profile per SoundSpa Organization. Profile text is dormant until a future authorized workflow is approved. */
export const commercialLegalEntities = pgTable("commercial_legal_entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  legalForm: text("legal_form").$type<"ru_legal_entity" | "ru_individual_entrepreneur">().notNull(),
  legalName: text("legal_name").notNull(),
  taxId: text("tax_id").notNull(),
  registrationNumber: text("registration_number").notNull(),
  registeredAddress: text("registered_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_legal_entities_id_org_unique").on(table.id, table.organizationId),
  index("commercial_legal_entities_organization_idx").on(table.organizationId),
  uniqueIndex("commercial_legal_entities_form_tax_id_unique").on(table.legalForm, table.taxId),
  index("commercial_legal_entities_tax_id_idx").on(table.taxId),
  check("commercial_legal_entities_form_valid", sql`${table.legalForm} IN ('ru_legal_entity','ru_individual_entrepreneur')`),
  check("commercial_legal_entities_name_nonempty", sql`length(btrim(${table.legalName})) BETWEEN 1 AND 300`),
  check("commercial_legal_entities_tax_id_valid", sql`(${table.legalForm} = 'ru_legal_entity' AND ${table.taxId} ~ '^[0-9]{10}$') OR (${table.legalForm} = 'ru_individual_entrepreneur' AND ${table.taxId} ~ '^[0-9]{12}$')`),
  check("commercial_legal_entities_registration_number_valid", sql`(${table.legalForm} = 'ru_legal_entity' AND ${table.registrationNumber} ~ '^[0-9]{13}$') OR (${table.legalForm} = 'ru_individual_entrepreneur' AND ${table.registrationNumber} ~ '^[0-9]{15}$')`),
  check("commercial_legal_entities_registered_address_nonempty", sql`${table.registeredAddress} IS NULL OR length(btrim(${table.registeredAddress})) BETWEEN 1 AND 1000`),
]);

/** Legal entity facts are shared, while each physical salon has its own address profile. */
export const commercialLocationLegalProfiles = pgTable("commercial_location_legal_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  locationId: uuid("location_id").notNull().unique(),
  physicalAddress: text("physical_address").notNull(),
  normalizedAddress: text("normalized_address").notNull(),
  addressRegistryId: text("address_registry_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_location_legal_profiles_id_scope_unique").on(table.id, table.organizationId, table.legalEntityId, table.locationId),
  index("commercial_location_legal_profiles_entity_idx").on(table.legalEntityId),
  foreignKey({ name: "commercial_location_legal_profiles_location_org_fk", columns: [table.locationId, table.organizationId], foreignColumns: [locations.id, locations.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_location_legal_profiles_entity_org_fk", columns: [table.legalEntityId, table.organizationId], foreignColumns: [commercialLegalEntities.id, commercialLegalEntities.organizationId] }).onDelete("restrict"),
  check("commercial_location_legal_profiles_address_nonempty", sql`length(btrim(${table.physicalAddress})) BETWEEN 1 AND 1000`),
  check("commercial_location_legal_profiles_normalized_nonempty", sql`length(btrim(${table.normalizedAddress})) BETWEEN 1 AND 1200`),
  check("commercial_location_legal_profiles_registry_id_nonempty", sql`${table.addressRegistryId} IS NULL OR length(btrim(${table.addressRegistryId})) BETWEEN 1 AND 160`),
]);

/** A document identity has no legal text; its content is held in independently versioned rows. */
export const commercialLegalDocuments = pgTable("commercial_legal_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  locale: text("locale").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_legal_documents_code_jurisdiction_locale_unique").on(table.code, table.jurisdiction, table.locale),
  check("commercial_legal_documents_code_format", sql`${table.code} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("commercial_legal_documents_jurisdiction_format", sql`${table.jurisdiction} ~ '^[A-Z]{2}$'`),
  check("commercial_legal_documents_locale_format", sql`length(btrim(${table.locale})) BETWEEN 2 AND 20`),
]);

/** Published content is frozen by the database trigger installed in migration 0037. */
export const commercialLegalDocumentVersions = pgTable("commercial_legal_document_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => commercialLegalDocuments.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  contentSha256: text("content_sha256").notNull(),
  status: text("status").$type<"draft" | "published" | "withdrawn">().notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedBy: text("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publicationReason: text("publication_reason"),
  withdrawnBy: text("withdrawn_by"),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  withdrawalReason: text("withdrawal_reason"),
}, (table) => [
  uniqueIndex("commercial_legal_document_versions_document_version_unique").on(table.documentId, table.version),
  uniqueIndex("commercial_legal_document_versions_id_document_unique").on(table.id, table.documentId),
  index("commercial_legal_document_versions_publication_idx").on(table.documentId, table.status, table.publishedAt),
  check("commercial_legal_document_versions_version_positive", sql`${table.version} > 0`),
  check("commercial_legal_document_versions_title_nonempty", sql`length(btrim(${table.title})) BETWEEN 1 AND 300`),
  check("commercial_legal_document_versions_content_nonempty", sql`length(btrim(${table.content})) > 0`),
  check("commercial_legal_document_versions_hash_sha256", sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
  check("commercial_legal_document_versions_hash_matches_content", sql`encode(sha256(convert_to(${table.content}, 'UTF8')), 'hex') = ${table.contentSha256}`),
  check("commercial_legal_document_versions_actor_nonempty", sql`length(btrim(${table.createdBy})) BETWEEN 1 AND 200`),
  check("commercial_legal_document_versions_lifecycle_shape", sql`
    (${table.status} = 'draft' AND ${table.publishedAt} IS NULL AND ${table.publishedBy} IS NULL AND ${table.publicationReason} IS NULL AND ${table.withdrawnAt} IS NULL AND ${table.withdrawnBy} IS NULL AND ${table.withdrawalReason} IS NULL) OR
    (${table.status} = 'published' AND ${table.publishedAt} IS NOT NULL AND ${table.publishedBy} IS NOT NULL AND length(btrim(${table.publishedBy})) BETWEEN 1 AND 200 AND ${table.publicationReason} IS NOT NULL AND length(btrim(${table.publicationReason})) BETWEEN 1 AND 500 AND ${table.withdrawnAt} IS NULL AND ${table.withdrawnBy} IS NULL AND ${table.withdrawalReason} IS NULL) OR
    (${table.status} = 'withdrawn' AND ${table.publishedAt} IS NOT NULL AND ${table.publishedBy} IS NOT NULL AND ${table.publicationReason} IS NOT NULL AND ${table.withdrawnAt} IS NOT NULL AND ${table.withdrawnBy} IS NOT NULL AND length(btrim(${table.withdrawnBy})) BETWEEN 1 AND 200 AND ${table.withdrawalReason} IS NOT NULL AND length(btrim(${table.withdrawalReason})) BETWEEN 1 AND 500 AND ${table.withdrawnAt} >= ${table.publishedAt})`),
]);

export const commercialLegalDocumentEvents = pgTable("commercial_legal_document_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentVersionId: uuid("document_version_id").notNull().references(() => commercialLegalDocumentVersions.id, { onDelete: "restrict" }),
  action: text("action").$type<"draft_created" | "published" | "withdrawn">().notNull(),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("commercial_legal_document_events_version_time_idx").on(table.documentVersionId, table.occurredAt),
  check("commercial_legal_document_events_action_valid", sql`${table.action} IN ('draft_created','published','withdrawn')`),
  check("commercial_legal_document_events_operator_nonempty", sql`length(btrim(${table.operator})) BETWEEN 1 AND 200`),
  check("commercial_legal_document_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
]);

/** Acceptance is a signed evidence event, not an entitlement. No acceptance rows are created by this migration. */
export const commercialAgreementAcceptances = pgTable("commercial_agreement_acceptances", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  locationId: uuid("location_id").notNull(),
  legalProfileId: uuid("legal_profile_id").notNull(),
  documentVersionId: uuid("document_version_id").notNull(),
  documentSha256: text("document_sha256").notNull(),
  legalEntitySnapshot: jsonb("legal_entity_snapshot").$type<Record<string, unknown>>().notNull(),
  locationSnapshot: jsonb("location_snapshot").$type<Record<string, unknown>>().notNull(),
  signerUserId: uuid("signer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  signerName: text("signer_name").notNull(),
  signerRole: text("signer_role").notNull(),
  authorityDeclaration: text("authority_declaration").notNull(),
  acceptanceMethod: text("acceptance_method").notNull(),
  evidenceMetadata: jsonb("evidence_metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  idempotencyKey: uuid("idempotency_key").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("commercial_agreement_acceptances_id_scope_unique").on(table.id, table.organizationId, table.legalEntityId, table.locationId),
  uniqueIndex("commercial_agreement_acceptances_idempotency_unique").on(table.idempotencyKey),
  index("commercial_agreement_acceptances_location_time_idx").on(table.locationId, table.acceptedAt),
  foreignKey({ name: "commercial_agreement_acceptances_location_org_fk", columns: [table.locationId, table.organizationId], foreignColumns: [locations.id, locations.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_agreement_acceptances_legal_entity_org_fk", columns: [table.legalEntityId, table.organizationId], foreignColumns: [commercialLegalEntities.id, commercialLegalEntities.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_agreement_acceptances_legal_profile_scope_fk", columns: [table.legalProfileId, table.organizationId, table.legalEntityId, table.locationId], foreignColumns: [commercialLocationLegalProfiles.id, commercialLocationLegalProfiles.organizationId, commercialLocationLegalProfiles.legalEntityId, commercialLocationLegalProfiles.locationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_agreement_acceptances_document_version_fk", columns: [table.documentVersionId], foreignColumns: [commercialLegalDocumentVersions.id] }).onDelete("restrict"),
  check("commercial_agreement_acceptances_document_hash_valid", sql`${table.documentSha256} ~ '^[0-9a-f]{64}$'`),
  check("commercial_agreement_acceptances_legal_entity_snapshot_object", sql`jsonb_typeof(${table.legalEntitySnapshot}) = 'object' AND jsonb_typeof(${table.legalEntitySnapshot}->'legalForm') = 'string' AND jsonb_typeof(${table.legalEntitySnapshot}->'legalName') = 'string' AND jsonb_typeof(${table.legalEntitySnapshot}->'taxId') = 'string' AND jsonb_typeof(${table.legalEntitySnapshot}->'registrationNumber') = 'string'`),
  check("commercial_agreement_acceptances_location_snapshot_object", sql`jsonb_typeof(${table.locationSnapshot}) = 'object' AND jsonb_typeof(${table.locationSnapshot}->'physicalAddress') = 'string'`),
  check("commercial_agreement_acceptances_signer_name_nonempty", sql`length(btrim(${table.signerName})) BETWEEN 1 AND 300`),
  check("commercial_agreement_acceptances_signer_role_nonempty", sql`length(btrim(${table.signerRole})) BETWEEN 1 AND 200`),
  check("commercial_agreement_acceptances_authority_nonempty", sql`length(btrim(${table.authorityDeclaration})) BETWEEN 1 AND 1000`),
  check("commercial_agreement_acceptances_method_nonempty", sql`length(btrim(${table.acceptanceMethod})) BETWEEN 1 AND 80`),
  check("commercial_agreement_acceptances_evidence_object", sql`jsonb_typeof(${table.evidenceMetadata}) = 'object'`),
]);

export const commercialAgreementAcceptanceEvents = pgTable("commercial_agreement_acceptance_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  acceptanceId: uuid("acceptance_id").notNull().references(() => commercialAgreementAcceptances.id, { onDelete: "restrict" }),
  action: text("action").$type<"revoked">().notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("commercial_agreement_acceptance_events_acceptance_unique").on(table.acceptanceId),
  index("commercial_agreement_acceptance_events_time_idx").on(table.acceptanceId, table.occurredAt),
  check("commercial_agreement_acceptance_events_action_valid", sql`${table.action} = 'revoked'`),
  check("commercial_agreement_acceptance_events_actor_nonempty", sql`length(btrim(${table.actor})) BETWEEN 1 AND 200`),
  check("commercial_agreement_acceptance_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
]);

/** Eligibility is deliberately not read by the commercial-access resolver and cannot itself grant playback. */
export const commercialSpaquatoriaGiftEligibility = pgTable("commercial_spaquatoria_gift_eligibility", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  legalEntityId: uuid("legal_entity_id").notNull(),
  locationId: uuid("location_id").notNull(),
  legalProfileId: uuid("legal_profile_id").notNull(),
  acceptanceId: uuid("acceptance_id").notNull(),
  physicalLocationKey: text("physical_location_key").notNull(),
  status: text("status").$type<"pending_review" | "eligible" | "rejected" | "revoked">().notNull().default("pending_review"),
  reviewedByOperator: text("reviewed_by_operator"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: text("review_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("commercial_spaquatoria_gift_eligibility_location_unique").on(table.locationId),
  uniqueIndex("commercial_spaquatoria_gift_eligibility_acceptance_unique").on(table.acceptanceId),
  uniqueIndex("commercial_spaquatoria_gift_eligibility_physical_location_unique").on(table.physicalLocationKey),
  uniqueIndex("commercial_spaquatoria_gift_eligibility_id_scope_unique").on(table.id, table.organizationId, table.legalEntityId, table.locationId, table.legalProfileId, table.acceptanceId),
  index("commercial_spaquatoria_gift_eligibility_status_idx").on(table.status, table.createdAt),
  foreignKey({ name: "commercial_spaquatoria_gift_eligibility_location_org_fk", columns: [table.locationId, table.organizationId], foreignColumns: [locations.id, locations.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_spaquatoria_gift_eligibility_entity_org_fk", columns: [table.legalEntityId, table.organizationId], foreignColumns: [commercialLegalEntities.id, commercialLegalEntities.organizationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_spaquatoria_gift_eligibility_profile_fk", columns: [table.legalProfileId, table.organizationId, table.legalEntityId, table.locationId], foreignColumns: [commercialLocationLegalProfiles.id, commercialLocationLegalProfiles.organizationId, commercialLocationLegalProfiles.legalEntityId, commercialLocationLegalProfiles.locationId] }).onDelete("restrict"),
  foreignKey({ name: "commercial_spaquatoria_gift_eligibility_acceptance_fk", columns: [table.acceptanceId, table.organizationId, table.legalEntityId, table.locationId], foreignColumns: [commercialAgreementAcceptances.id, commercialAgreementAcceptances.organizationId, commercialAgreementAcceptances.legalEntityId, commercialAgreementAcceptances.locationId] }).onDelete("restrict"),
  check("commercial_spaquatoria_gift_eligibility_status_valid", sql`${table.status} IN ('pending_review','eligible','rejected','revoked')`),
  check("commercial_spaquatoria_gift_eligibility_location_key_nonempty", sql`length(btrim(${table.physicalLocationKey})) BETWEEN 1 AND 1200`),
  check("commercial_spaquatoria_gift_eligibility_review_shape", sql`(${table.status} = 'pending_review' AND ${table.reviewedByOperator} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.reviewReason} IS NULL) OR (${table.status} <> 'pending_review' AND ${table.reviewedByOperator} IS NOT NULL AND length(btrim(${table.reviewedByOperator})) BETWEEN 1 AND 200 AND ${table.reviewedAt} IS NOT NULL AND ${table.reviewReason} IS NOT NULL AND length(btrim(${table.reviewReason})) BETWEEN 1 AND 500)`),
]);

/** Review and revocation history is separate from eligibility identity and is append-only. */
export const commercialSpaquatoriaGiftEligibilityEvents = pgTable("commercial_spaquatoria_gift_eligibility_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  eligibilityId: uuid("eligibility_id").notNull().references(() => commercialSpaquatoriaGiftEligibility.id, { onDelete: "restrict" }),
  action: text("action").$type<"submitted" | "approved" | "rejected" | "revoked">().notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorType: text("actor_type").$type<"customer" | "operator">().notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("commercial_spaquatoria_gift_eligibility_events_time_idx").on(table.eligibilityId, table.occurredAt),
  uniqueIndex("commercial_spaquatoria_gift_eligibility_events_transition_unique").on(table.eligibilityId, table.action),
  check("commercial_spaquatoria_gift_eligibility_events_action_valid", sql`${table.action} IN ('submitted','approved','rejected','revoked')`),
  check("commercial_spaquatoria_gift_eligibility_events_status_valid", sql`
    (${table.action} = 'submitted' AND ${table.fromStatus} IS NULL AND ${table.toStatus} = 'pending_review' AND ${table.actorType} = 'customer') OR
    (${table.action} = 'approved' AND ${table.fromStatus} = 'pending_review' AND ${table.toStatus} = 'eligible' AND ${table.actorType} = 'operator') OR
    (${table.action} = 'rejected' AND ${table.fromStatus} = 'pending_review' AND ${table.toStatus} = 'rejected' AND ${table.actorType} = 'operator') OR
    (${table.action} = 'revoked' AND ${table.fromStatus} = 'eligible' AND ${table.toStatus} = 'revoked' AND ${table.actorType} = 'operator')`),
  check("commercial_spaquatoria_gift_eligibility_events_actor_nonempty", sql`length(btrim(${table.actorId})) BETWEEN 1 AND 200`),
  check("commercial_spaquatoria_gift_eligibility_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
]);

/** Append-only link from Gift eligibility to existing Device–Product assignment history. */
export const commercialSpaquatoriaGiftDeviceEvents = pgTable("commercial_spaquatoria_gift_device_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  eligibilityId: uuid("eligibility_id").notNull().references(() => commercialSpaquatoriaGiftEligibility.id, { onDelete: "restrict" }),
  deviceProductAssignmentId: uuid("device_product_assignment_id").notNull().references(() => deviceProductAssignments.id, { onDelete: "restrict" }),
  action: text("action").$type<"assigned" | "revoked" | "replaced">().notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("commercial_spaquatoria_gift_device_events_eligibility_time_idx").on(table.eligibilityId, table.occurredAt),
  index("commercial_spaquatoria_gift_device_events_assignment_idx").on(table.deviceProductAssignmentId),
  check("commercial_spaquatoria_gift_device_events_action_valid", sql`${table.action} IN ('assigned','revoked','replaced')`),
  check("commercial_spaquatoria_gift_device_events_actor_nonempty", sql`length(btrim(${table.actor})) BETWEEN 1 AND 200`),
  check("commercial_spaquatoria_gift_device_events_reason_nonempty", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
]);
