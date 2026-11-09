CREATE TABLE "commercial_agreement_acceptance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_agreement_acceptance_events_action_valid" CHECK ("commercial_agreement_acceptance_events"."action" = 'revoked'),
	CONSTRAINT "commercial_agreement_acceptance_events_actor_nonempty" CHECK (length(btrim("commercial_agreement_acceptance_events"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_agreement_acceptance_events_reason_nonempty" CHECK (length(btrim("commercial_agreement_acceptance_events"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "commercial_agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"legal_profile_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"document_sha256" text NOT NULL,
	"legal_entity_snapshot" jsonb NOT NULL,
	"location_snapshot" jsonb NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signer_role" text NOT NULL,
	"authority_declaration" text NOT NULL,
	"acceptance_method" text NOT NULL,
	"evidence_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_agreement_acceptances_document_hash_valid" CHECK ("commercial_agreement_acceptances"."document_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commercial_agreement_acceptances_legal_entity_snapshot_object" CHECK (jsonb_typeof("commercial_agreement_acceptances"."legal_entity_snapshot") = 'object' AND jsonb_typeof("commercial_agreement_acceptances"."legal_entity_snapshot"->'legalForm') = 'string' AND jsonb_typeof("commercial_agreement_acceptances"."legal_entity_snapshot"->'legalName') = 'string' AND jsonb_typeof("commercial_agreement_acceptances"."legal_entity_snapshot"->'taxId') = 'string' AND jsonb_typeof("commercial_agreement_acceptances"."legal_entity_snapshot"->'registrationNumber') = 'string'),
	CONSTRAINT "commercial_agreement_acceptances_location_snapshot_object" CHECK (jsonb_typeof("commercial_agreement_acceptances"."location_snapshot") = 'object' AND jsonb_typeof("commercial_agreement_acceptances"."location_snapshot"->'physicalAddress') = 'string'),
	CONSTRAINT "commercial_agreement_acceptances_signer_name_nonempty" CHECK (length(btrim("commercial_agreement_acceptances"."signer_name")) BETWEEN 1 AND 300),
	CONSTRAINT "commercial_agreement_acceptances_signer_role_nonempty" CHECK (length(btrim("commercial_agreement_acceptances"."signer_role")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_agreement_acceptances_authority_nonempty" CHECK (length(btrim("commercial_agreement_acceptances"."authority_declaration")) BETWEEN 1 AND 1000),
	CONSTRAINT "commercial_agreement_acceptances_method_nonempty" CHECK (length(btrim("commercial_agreement_acceptances"."acceptance_method")) BETWEEN 1 AND 80),
	CONSTRAINT "commercial_agreement_acceptances_evidence_object" CHECK (jsonb_typeof("commercial_agreement_acceptances"."evidence_metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commercial_legal_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"action" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_legal_document_events_action_valid" CHECK ("commercial_legal_document_events"."action" IN ('draft_created','published','withdrawn')),
	CONSTRAINT "commercial_legal_document_events_operator_nonempty" CHECK (length(btrim("commercial_legal_document_events"."operator")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_legal_document_events_reason_nonempty" CHECK (length(btrim("commercial_legal_document_events"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "commercial_legal_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"publication_reason" text,
	"withdrawn_by" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawal_reason" text,
	CONSTRAINT "commercial_legal_document_versions_version_positive" CHECK ("commercial_legal_document_versions"."version" > 0),
	CONSTRAINT "commercial_legal_document_versions_title_nonempty" CHECK (length(btrim("commercial_legal_document_versions"."title")) BETWEEN 1 AND 300),
	CONSTRAINT "commercial_legal_document_versions_content_nonempty" CHECK (length(btrim("commercial_legal_document_versions"."content")) > 0),
	CONSTRAINT "commercial_legal_document_versions_hash_sha256" CHECK ("commercial_legal_document_versions"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commercial_legal_document_versions_hash_matches_content" CHECK (encode(sha256(convert_to("commercial_legal_document_versions"."content", 'UTF8')), 'hex') = "commercial_legal_document_versions"."content_sha256"),
	CONSTRAINT "commercial_legal_document_versions_actor_nonempty" CHECK (length(btrim("commercial_legal_document_versions"."created_by")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_legal_document_versions_lifecycle_shape" CHECK (
    ("commercial_legal_document_versions"."status" = 'draft' AND "commercial_legal_document_versions"."published_at" IS NULL AND "commercial_legal_document_versions"."published_by" IS NULL AND "commercial_legal_document_versions"."publication_reason" IS NULL AND "commercial_legal_document_versions"."withdrawn_at" IS NULL AND "commercial_legal_document_versions"."withdrawn_by" IS NULL AND "commercial_legal_document_versions"."withdrawal_reason" IS NULL) OR
    ("commercial_legal_document_versions"."status" = 'published' AND "commercial_legal_document_versions"."published_at" IS NOT NULL AND "commercial_legal_document_versions"."published_by" IS NOT NULL AND length(btrim("commercial_legal_document_versions"."published_by")) BETWEEN 1 AND 200 AND "commercial_legal_document_versions"."publication_reason" IS NOT NULL AND length(btrim("commercial_legal_document_versions"."publication_reason")) BETWEEN 1 AND 500 AND "commercial_legal_document_versions"."withdrawn_at" IS NULL AND "commercial_legal_document_versions"."withdrawn_by" IS NULL AND "commercial_legal_document_versions"."withdrawal_reason" IS NULL) OR
    ("commercial_legal_document_versions"."status" = 'withdrawn' AND "commercial_legal_document_versions"."published_at" IS NOT NULL AND "commercial_legal_document_versions"."published_by" IS NOT NULL AND "commercial_legal_document_versions"."publication_reason" IS NOT NULL AND "commercial_legal_document_versions"."withdrawn_at" IS NOT NULL AND "commercial_legal_document_versions"."withdrawn_by" IS NOT NULL AND length(btrim("commercial_legal_document_versions"."withdrawn_by")) BETWEEN 1 AND 200 AND "commercial_legal_document_versions"."withdrawal_reason" IS NOT NULL AND length(btrim("commercial_legal_document_versions"."withdrawal_reason")) BETWEEN 1 AND 500 AND "commercial_legal_document_versions"."withdrawn_at" >= "commercial_legal_document_versions"."published_at"))
);
--> statement-breakpoint
CREATE TABLE "commercial_legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_legal_documents_code_format" CHECK ("commercial_legal_documents"."code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "commercial_legal_documents_jurisdiction_format" CHECK ("commercial_legal_documents"."jurisdiction" ~ '^[A-Z]{2}$'),
	CONSTRAINT "commercial_legal_documents_locale_format" CHECK (length(btrim("commercial_legal_documents"."locale")) BETWEEN 2 AND 20)
);
--> statement-breakpoint
CREATE TABLE "commercial_legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_form" text NOT NULL,
	"legal_name" text NOT NULL,
	"tax_id" text NOT NULL,
	"registration_number" text NOT NULL,
	"registered_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_legal_entities_form_valid" CHECK ("commercial_legal_entities"."legal_form" IN ('ru_legal_entity','ru_individual_entrepreneur')),
	CONSTRAINT "commercial_legal_entities_name_nonempty" CHECK (length(btrim("commercial_legal_entities"."legal_name")) BETWEEN 1 AND 300),
	CONSTRAINT "commercial_legal_entities_tax_id_valid" CHECK (("commercial_legal_entities"."legal_form" = 'ru_legal_entity' AND "commercial_legal_entities"."tax_id" ~ '^[0-9]{10}$') OR ("commercial_legal_entities"."legal_form" = 'ru_individual_entrepreneur' AND "commercial_legal_entities"."tax_id" ~ '^[0-9]{12}$')),
	CONSTRAINT "commercial_legal_entities_registration_number_valid" CHECK (("commercial_legal_entities"."legal_form" = 'ru_legal_entity' AND "commercial_legal_entities"."registration_number" ~ '^[0-9]{13}$') OR ("commercial_legal_entities"."legal_form" = 'ru_individual_entrepreneur' AND "commercial_legal_entities"."registration_number" ~ '^[0-9]{15}$')),
	CONSTRAINT "commercial_legal_entities_registered_address_nonempty" CHECK ("commercial_legal_entities"."registered_address" IS NULL OR length(btrim("commercial_legal_entities"."registered_address")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "commercial_location_legal_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"physical_address" text NOT NULL,
	"normalized_address" text NOT NULL,
	"address_registry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_location_legal_profiles_location_id_unique" UNIQUE("location_id"),
	CONSTRAINT "commercial_location_legal_profiles_address_nonempty" CHECK (length(btrim("commercial_location_legal_profiles"."physical_address")) BETWEEN 1 AND 1000),
	CONSTRAINT "commercial_location_legal_profiles_normalized_nonempty" CHECK (length(btrim("commercial_location_legal_profiles"."normalized_address")) BETWEEN 1 AND 1200),
	CONSTRAINT "commercial_location_legal_profiles_registry_id_nonempty" CHECK ("commercial_location_legal_profiles"."address_registry_id" IS NULL OR length(btrim("commercial_location_legal_profiles"."address_registry_id")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE TABLE "commercial_spaquatoria_gift_device_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eligibility_id" uuid NOT NULL,
	"device_product_assignment_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_spaquatoria_gift_device_events_action_valid" CHECK ("commercial_spaquatoria_gift_device_events"."action" IN ('assigned','revoked','replaced')),
	CONSTRAINT "commercial_spaquatoria_gift_device_events_actor_nonempty" CHECK (length(btrim("commercial_spaquatoria_gift_device_events"."actor")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_spaquatoria_gift_device_events_reason_nonempty" CHECK (length(btrim("commercial_spaquatoria_gift_device_events"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "commercial_spaquatoria_gift_eligibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"legal_profile_id" uuid NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"physical_location_key" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_operator" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_status_valid" CHECK ("commercial_spaquatoria_gift_eligibility"."status" IN ('pending_review','eligible','rejected','revoked')),
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_location_key_nonempty" CHECK (length(btrim("commercial_spaquatoria_gift_eligibility"."physical_location_key")) BETWEEN 1 AND 1200),
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_review_shape" CHECK (("commercial_spaquatoria_gift_eligibility"."status" = 'pending_review' AND "commercial_spaquatoria_gift_eligibility"."reviewed_by_operator" IS NULL AND "commercial_spaquatoria_gift_eligibility"."reviewed_at" IS NULL AND "commercial_spaquatoria_gift_eligibility"."review_reason" IS NULL) OR ("commercial_spaquatoria_gift_eligibility"."status" <> 'pending_review' AND "commercial_spaquatoria_gift_eligibility"."reviewed_by_operator" IS NOT NULL AND length(btrim("commercial_spaquatoria_gift_eligibility"."reviewed_by_operator")) BETWEEN 1 AND 200 AND "commercial_spaquatoria_gift_eligibility"."reviewed_at" IS NOT NULL AND "commercial_spaquatoria_gift_eligibility"."review_reason" IS NOT NULL AND length(btrim("commercial_spaquatoria_gift_eligibility"."review_reason")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "commercial_spaquatoria_gift_eligibility_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eligibility_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_events_action_valid" CHECK ("commercial_spaquatoria_gift_eligibility_events"."action" IN ('submitted','approved','rejected','revoked')),
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_events_status_valid" CHECK (
    ("commercial_spaquatoria_gift_eligibility_events"."action" = 'submitted' AND "commercial_spaquatoria_gift_eligibility_events"."from_status" IS NULL AND "commercial_spaquatoria_gift_eligibility_events"."to_status" = 'pending_review' AND "commercial_spaquatoria_gift_eligibility_events"."actor_type" = 'customer') OR
    ("commercial_spaquatoria_gift_eligibility_events"."action" = 'approved' AND "commercial_spaquatoria_gift_eligibility_events"."from_status" = 'pending_review' AND "commercial_spaquatoria_gift_eligibility_events"."to_status" = 'eligible' AND "commercial_spaquatoria_gift_eligibility_events"."actor_type" = 'operator') OR
    ("commercial_spaquatoria_gift_eligibility_events"."action" = 'rejected' AND "commercial_spaquatoria_gift_eligibility_events"."from_status" = 'pending_review' AND "commercial_spaquatoria_gift_eligibility_events"."to_status" = 'rejected' AND "commercial_spaquatoria_gift_eligibility_events"."actor_type" = 'operator') OR
    ("commercial_spaquatoria_gift_eligibility_events"."action" = 'revoked' AND "commercial_spaquatoria_gift_eligibility_events"."from_status" = 'eligible' AND "commercial_spaquatoria_gift_eligibility_events"."to_status" = 'revoked' AND "commercial_spaquatoria_gift_eligibility_events"."actor_type" = 'operator')),
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_events_actor_nonempty" CHECK (length(btrim("commercial_spaquatoria_gift_eligibility_events"."actor_id")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_spaquatoria_gift_eligibility_events_reason_nonempty" CHECK (length(btrim("commercial_spaquatoria_gift_eligibility_events"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_agreement_acceptances_id_scope_unique" ON "commercial_agreement_acceptances" USING btree ("id","organization_id","legal_entity_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_legal_entities_id_org_unique" ON "commercial_legal_entities" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_location_legal_profiles_id_scope_unique" ON "commercial_location_legal_profiles" USING btree ("id","organization_id","legal_entity_id","location_id");--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE "commercial_agreement_acceptance_events" ADD CONSTRAINT "commercial_agreement_acceptance_events_acceptance_id_commercial_agreement_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."commercial_agreement_acceptances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_acceptances" ADD CONSTRAINT "commercial_agreement_acceptances_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_acceptances" ADD CONSTRAINT "commercial_agreement_acceptances_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_acceptances" ADD CONSTRAINT "commercial_agreement_acceptances_legal_entity_org_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."commercial_legal_entities"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_acceptances" ADD CONSTRAINT "commercial_agreement_acceptances_legal_profile_scope_fk" FOREIGN KEY ("legal_profile_id","organization_id","legal_entity_id","location_id") REFERENCES "public"."commercial_location_legal_profiles"("id","organization_id","legal_entity_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_agreement_acceptances" ADD CONSTRAINT "commercial_agreement_acceptances_document_version_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."commercial_legal_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_legal_document_events" ADD CONSTRAINT "commercial_legal_document_events_document_version_id_commercial_legal_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."commercial_legal_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_legal_document_versions" ADD CONSTRAINT "commercial_legal_document_versions_document_id_commercial_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."commercial_legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_legal_entities" ADD CONSTRAINT "commercial_legal_entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_location_legal_profiles" ADD CONSTRAINT "commercial_location_legal_profiles_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_location_legal_profiles" ADD CONSTRAINT "commercial_location_legal_profiles_entity_org_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."commercial_legal_entities"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_device_events" ADD CONSTRAINT "commercial_spaquatoria_gift_device_events_eligibility_id_commercial_spaquatoria_gift_eligibility_id_fk" FOREIGN KEY ("eligibility_id") REFERENCES "public"."commercial_spaquatoria_gift_eligibility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_device_events" ADD CONSTRAINT "commercial_spaquatoria_gift_device_events_device_product_assignment_id_device_product_assignments_id_fk" FOREIGN KEY ("device_product_assignment_id") REFERENCES "public"."device_product_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_eligibility" ADD CONSTRAINT "commercial_spaquatoria_gift_eligibility_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_eligibility" ADD CONSTRAINT "commercial_spaquatoria_gift_eligibility_entity_org_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."commercial_legal_entities"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_eligibility" ADD CONSTRAINT "commercial_spaquatoria_gift_eligibility_profile_fk" FOREIGN KEY ("legal_profile_id","organization_id","legal_entity_id","location_id") REFERENCES "public"."commercial_location_legal_profiles"("id","organization_id","legal_entity_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_eligibility" ADD CONSTRAINT "commercial_spaquatoria_gift_eligibility_acceptance_fk" FOREIGN KEY ("acceptance_id","organization_id","legal_entity_id","location_id") REFERENCES "public"."commercial_agreement_acceptances"("id","organization_id","legal_entity_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_eligibility_events" ADD CONSTRAINT "commercial_spaquatoria_gift_eligibility_events_eligibility_id_commercial_spaquatoria_gift_eligibility_id_fk" FOREIGN KEY ("eligibility_id") REFERENCES "public"."commercial_spaquatoria_gift_eligibility"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_agreement_acceptance_events_acceptance_unique" ON "commercial_agreement_acceptance_events" USING btree ("acceptance_id");--> statement-breakpoint
CREATE INDEX "commercial_agreement_acceptance_events_time_idx" ON "commercial_agreement_acceptance_events" USING btree ("acceptance_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_agreement_acceptances_idempotency_unique" ON "commercial_agreement_acceptances" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "commercial_agreement_acceptances_location_time_idx" ON "commercial_agreement_acceptances" USING btree ("location_id","accepted_at");--> statement-breakpoint
CREATE INDEX "commercial_legal_document_events_version_time_idx" ON "commercial_legal_document_events" USING btree ("document_version_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_legal_document_versions_document_version_unique" ON "commercial_legal_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_legal_document_versions_id_document_unique" ON "commercial_legal_document_versions" USING btree ("id","document_id");--> statement-breakpoint
CREATE INDEX "commercial_legal_document_versions_publication_idx" ON "commercial_legal_document_versions" USING btree ("document_id","status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_legal_documents_code_jurisdiction_locale_unique" ON "commercial_legal_documents" USING btree ("code","jurisdiction","locale");--> statement-breakpoint
CREATE INDEX "commercial_legal_entities_organization_idx" ON "commercial_legal_entities" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_legal_entities_form_tax_id_unique" ON "commercial_legal_entities" USING btree ("legal_form","tax_id");--> statement-breakpoint
CREATE INDEX "commercial_legal_entities_tax_id_idx" ON "commercial_legal_entities" USING btree ("tax_id");--> statement-breakpoint
CREATE INDEX "commercial_location_legal_profiles_entity_idx" ON "commercial_location_legal_profiles" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_gift_device_events_eligibility_time_idx" ON "commercial_spaquatoria_gift_device_events" USING btree ("eligibility_id","occurred_at");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_gift_device_events_assignment_idx" ON "commercial_spaquatoria_gift_device_events" USING btree ("device_product_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_eligibility_location_unique" ON "commercial_spaquatoria_gift_eligibility" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_eligibility_acceptance_unique" ON "commercial_spaquatoria_gift_eligibility" USING btree ("acceptance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_eligibility_physical_location_unique" ON "commercial_spaquatoria_gift_eligibility" USING btree ("physical_location_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_eligibility_id_scope_unique" ON "commercial_spaquatoria_gift_eligibility" USING btree ("id","organization_id","legal_entity_id","location_id","legal_profile_id","acceptance_id");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_gift_eligibility_status_idx" ON "commercial_spaquatoria_gift_eligibility" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_gift_eligibility_events_time_idx" ON "commercial_spaquatoria_gift_eligibility_events" USING btree ("eligibility_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_eligibility_events_transition_unique" ON "commercial_spaquatoria_gift_eligibility_events" USING btree ("eligibility_id","action");--> statement-breakpoint
-- The foundation stores evidence only. It never writes Partner Benefits, Promotional Access,
-- Device assignments, or any resolver input.
CREATE FUNCTION "commercial_legal_reject_history_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legal agreement and Gift audit history is append-only';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "commercial_legal_document_version_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legal document versions cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'legal document versions must be created as drafts';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.document_id IS DISTINCT FROM OLD.document_id OR
     NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'legal document version identity is immutable';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
    RETURN NEW;
  ELSIF OLD.status = 'draft' AND NEW.status = 'published' THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.content IS DISTINCT FROM OLD.content OR
       NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.published_at IS NULL OR
       NEW.published_by IS NULL OR NEW.publication_reason IS NULL THEN
      RAISE EXCEPTION 'publication must freeze the finalized draft content and include actor, time and reason';
    END IF;
    RETURN NEW;
  ELSIF OLD.status = 'published' AND NEW.status = 'withdrawn' THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.content IS DISTINCT FROM OLD.content OR
       NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.published_at IS DISTINCT FROM OLD.published_at OR
       NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.publication_reason IS DISTINCT FROM OLD.publication_reason OR
       NEW.withdrawn_at IS NULL OR NEW.withdrawn_by IS NULL OR NEW.withdrawal_reason IS NULL THEN
      RAISE EXCEPTION 'withdrawal may only add audited withdrawal metadata';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published legal document content is immutable and lifecycle transitions are one-way';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "commercial_legal_document_version_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_action text;
  event_actor text;
  event_reason text;
  event_time timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "commercial_legal_document_events" ("document_version_id", "action", "operator", "reason", "occurred_at")
    VALUES (NEW.id, 'draft_created', NEW.created_by, 'Initial draft version created.', NEW.created_at);
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'published' THEN
      event_action := 'published'; event_actor := NEW.published_by; event_reason := NEW.publication_reason; event_time := NEW.published_at;
    ELSE
      event_action := 'withdrawn'; event_actor := NEW.withdrawn_by; event_reason := NEW.withdrawal_reason; event_time := NEW.withdrawn_at;
    END IF;
    INSERT INTO "commercial_legal_document_events" ("document_version_id", "action", "operator", "reason", "occurred_at")
    VALUES (NEW.id, event_action, event_actor, event_reason, event_time);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commercial_legal_document_versions_guard" BEFORE INSERT OR UPDATE OR DELETE ON "commercial_legal_document_versions" FOR EACH ROW EXECUTE FUNCTION "commercial_legal_document_version_guard"();--> statement-breakpoint
CREATE TRIGGER "commercial_legal_document_versions_event" AFTER INSERT OR UPDATE ON "commercial_legal_document_versions" FOR EACH ROW EXECUTE FUNCTION "commercial_legal_document_version_event"();--> statement-breakpoint
CREATE TRIGGER "commercial_legal_document_events_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "commercial_legal_document_events" FOR EACH STATEMENT EXECUTE FUNCTION "commercial_legal_reject_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "commercial_legal_documents_identity_immutable" BEFORE UPDATE OR DELETE OR TRUNCATE ON "commercial_legal_documents" FOR EACH STATEMENT EXECUTE FUNCTION "commercial_legal_reject_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "commercial_agreement_acceptances_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "commercial_agreement_acceptances" FOR EACH STATEMENT EXECUTE FUNCTION "commercial_legal_reject_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "commercial_agreement_acceptance_events_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "commercial_agreement_acceptance_events" FOR EACH STATEMENT EXECUTE FUNCTION "commercial_legal_reject_history_mutation"();--> statement-breakpoint
CREATE FUNCTION "commercial_legal_entity_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "commercial_agreement_acceptances" WHERE legal_entity_id = OLD.id) THEN
      RAISE EXCEPTION 'legal entity with accepted agreement evidence cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'legal entity identity and Organization scope are immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM "commercial_agreement_acceptances" WHERE legal_entity_id = OLD.id) THEN
    RAISE EXCEPTION 'legal entity profile is frozen after agreement acceptance';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "commercial_location_legal_profile_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "commercial_agreement_acceptances" WHERE legal_profile_id = OLD.id) OR
       EXISTS (SELECT 1 FROM "commercial_spaquatoria_gift_eligibility" WHERE legal_profile_id = OLD.id) THEN
      RAISE EXCEPTION 'Location legal profile with legal evidence cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    RAISE EXCEPTION 'Location legal profile identity and tenant scope are immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM "commercial_agreement_acceptances" WHERE legal_profile_id = OLD.id) OR
     EXISTS (SELECT 1 FROM "commercial_spaquatoria_gift_eligibility" WHERE legal_profile_id = OLD.id) THEN
    RAISE EXCEPTION 'Location legal profile is frozen after agreement or Gift eligibility evidence';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commercial_legal_entities_guard" BEFORE UPDATE OR DELETE ON "commercial_legal_entities" FOR EACH ROW EXECUTE FUNCTION "commercial_legal_entity_guard"();--> statement-breakpoint
CREATE TRIGGER "commercial_location_legal_profiles_guard" BEFORE UPDATE OR DELETE ON "commercial_location_legal_profiles" FOR EACH ROW EXECUTE FUNCTION "commercial_location_legal_profile_guard"();--> statement-breakpoint
CREATE FUNCTION "commercial_agreement_acceptance_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_published_at timestamptz;
  v_hash text;
  v_withdrawn_at timestamptz;
  v_legal_form text;
  v_legal_name text;
  v_tax_id text;
  v_registration_number text;
  v_physical_address text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'agreement acceptance is immutable';
  END IF;
  SELECT status, published_at, content_sha256, withdrawn_at
    INTO v_status, v_published_at, v_hash, v_withdrawn_at
    FROM "commercial_legal_document_versions" WHERE id = NEW.document_version_id FOR SHARE;
  IF v_status IS DISTINCT FROM 'published' OR v_published_at IS NULL OR v_withdrawn_at IS NOT NULL OR
     v_hash IS DISTINCT FROM NEW.document_sha256 OR NEW.accepted_at < v_published_at THEN
    RAISE EXCEPTION 'acceptance must reference the exact active published document version';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "organization_members" m
    JOIN "users" u ON u.id = m.user_id
    WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.signer_user_id
      AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'agreement signer must be an active verified organization member';
  END IF;
  SELECT legal_form, legal_name, tax_id, registration_number INTO v_legal_form, v_legal_name, v_tax_id, v_registration_number
    FROM "commercial_legal_entities" WHERE id = NEW.legal_entity_id AND organization_id = NEW.organization_id;
  SELECT physical_address INTO v_physical_address FROM "commercial_location_legal_profiles"
    WHERE id = NEW.legal_profile_id AND organization_id = NEW.organization_id
      AND legal_entity_id = NEW.legal_entity_id AND location_id = NEW.location_id;
  IF NEW.legal_entity_snapshot->>'legalForm' IS DISTINCT FROM v_legal_form OR
     NEW.legal_entity_snapshot->>'legalName' IS DISTINCT FROM v_legal_name OR
     NEW.legal_entity_snapshot->>'taxId' IS DISTINCT FROM v_tax_id OR
     NEW.legal_entity_snapshot->>'registrationNumber' IS DISTINCT FROM v_registration_number OR
     NEW.location_snapshot->>'physicalAddress' IS DISTINCT FROM v_physical_address THEN
    RAISE EXCEPTION 'acceptance snapshots must match the exact legal and physical Location profiles';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commercial_agreement_acceptances_guard" BEFORE INSERT OR UPDATE OR DELETE ON "commercial_agreement_acceptances" FOR EACH ROW EXECUTE FUNCTION "commercial_agreement_acceptance_guard"();--> statement-breakpoint
CREATE FUNCTION "commercial_spaquatoria_gift_eligibility_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_signer text;
  v_acceptance_document uuid;
  v_document_status text;
  v_document_hash text;
  v_withdrawn_at timestamptz;
  v_profile_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Spaquatoria Gift eligibility history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_review' OR NEW.reviewed_by_operator IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.review_reason IS NOT NULL THEN
      RAISE EXCEPTION 'new Gift eligibility must begin pending review';
    END IF;
    SELECT a.signer_user_id::text, a.document_version_id, p.normalized_address
      INTO v_signer, v_acceptance_document, v_profile_key
      FROM "commercial_agreement_acceptances" a
      JOIN "commercial_location_legal_profiles" p ON p.id = NEW.legal_profile_id
        AND p.organization_id = NEW.organization_id AND p.legal_entity_id = NEW.legal_entity_id AND p.location_id = NEW.location_id
      LEFT JOIN "commercial_agreement_acceptance_events" ae ON ae.acceptance_id = a.id
      WHERE a.id = NEW.acceptance_id AND a.organization_id = NEW.organization_id
        AND a.legal_entity_id = NEW.legal_entity_id AND a.location_id = NEW.location_id
        AND ae.id IS NULL;
    IF v_signer IS NULL OR NEW.physical_location_key IS DISTINCT FROM v_profile_key THEN
      RAISE EXCEPTION 'Gift eligibility requires a non-revoked same-Location acceptance and its normalized address key';
    END IF;
    SELECT status, content_sha256, withdrawn_at INTO v_document_status, v_document_hash, v_withdrawn_at
      FROM "commercial_legal_document_versions" WHERE id = v_acceptance_document;
    IF v_document_status IS DISTINCT FROM 'published' OR v_withdrawn_at IS NOT NULL OR
       NOT EXISTS (SELECT 1 FROM "commercial_agreement_acceptances" a
         JOIN "commercial_legal_document_versions" v ON v.id = a.document_version_id
         JOIN "commercial_legal_documents" d ON d.id = v.document_id
         WHERE a.id = NEW.acceptance_id AND v.id = v_acceptance_document
           AND a.document_sha256 = v.content_sha256 AND v.content_sha256 = v_document_hash
           AND d.code = 'spaquatoria-public-performance-license' AND d.jurisdiction = 'RU') THEN
      RAISE EXCEPTION 'Gift eligibility requires a valid published agreement acceptance';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR NEW.location_id IS DISTINCT FROM OLD.location_id OR
     NEW.legal_profile_id IS DISTINCT FROM OLD.legal_profile_id OR NEW.acceptance_id IS DISTINCT FROM OLD.acceptance_id OR
     NEW.physical_location_key IS DISTINCT FROM OLD.physical_location_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Spaquatoria Gift eligibility identity and accepted evidence are immutable';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.reviewed_by_operator IS DISTINCT FROM OLD.reviewed_by_operator OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR
       NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
      RAISE EXCEPTION 'Gift eligibility review metadata cannot change without a status transition';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'pending_review' AND NEW.status IN ('eligible','rejected')) OR (OLD.status = 'eligible' AND NEW.status = 'revoked')) THEN
    RAISE EXCEPTION 'Gift eligibility transitions are one-way';
  END IF;
  IF NEW.reviewed_by_operator IS NULL OR length(btrim(NEW.reviewed_by_operator)) = 0 OR NEW.reviewed_at IS NULL OR
     NEW.review_reason IS NULL OR length(btrim(NEW.review_reason)) = 0 THEN
    RAISE EXCEPTION 'Gift eligibility review and revocation require operator, timestamp and reason';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "commercial_spaquatoria_gift_eligibility_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_action text;
  event_actor_type text;
  event_actor_id text;
  event_reason text;
  event_time timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT signer_user_id::text INTO event_actor_id FROM "commercial_agreement_acceptances" WHERE id = NEW.acceptance_id;
    INSERT INTO "commercial_spaquatoria_gift_eligibility_events" ("eligibility_id", "action", "from_status", "to_status", "actor_type", "actor_id", "reason", "occurred_at")
    VALUES (NEW.id, 'submitted', NULL, 'pending_review', 'customer', event_actor_id, 'Eligibility request recorded with accepted agreement.', NEW.created_at);
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'eligible' THEN event_action := 'approved';
    ELSIF NEW.status = 'rejected' THEN event_action := 'rejected';
    ELSE event_action := 'revoked'; END IF;
    event_actor_type := 'operator'; event_actor_id := NEW.reviewed_by_operator; event_reason := NEW.review_reason; event_time := NEW.reviewed_at;
    INSERT INTO "commercial_spaquatoria_gift_eligibility_events" ("eligibility_id", "action", "from_status", "to_status", "actor_type", "actor_id", "reason", "occurred_at")
    VALUES (NEW.id, event_action, OLD.status, NEW.status, event_actor_type, event_actor_id, event_reason, event_time);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_gift_eligibility_guard" BEFORE INSERT OR UPDATE OR DELETE ON "commercial_spaquatoria_gift_eligibility" FOR EACH ROW EXECUTE FUNCTION "commercial_spaquatoria_gift_eligibility_guard"();--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_gift_eligibility_event" AFTER INSERT OR UPDATE ON "commercial_spaquatoria_gift_eligibility" FOR EACH ROW EXECUTE FUNCTION "commercial_spaquatoria_gift_eligibility_event"();--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_gift_eligibility_events_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "commercial_spaquatoria_gift_eligibility_events" FOR EACH STATEMENT EXECUTE FUNCTION "commercial_legal_reject_history_mutation"();--> statement-breakpoint
CREATE FUNCTION "commercial_spaquatoria_gift_device_event_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_location uuid;
  v_assignment_location uuid;
  v_status text;
  v_product_code text;
  v_acceptance uuid;
  v_document_status text;
  v_assignment_revoked timestamptz;
  v_device_status text;
  v_device_revoked timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Spaquatoria Gift Device history is append-only'; END IF;
  SELECT e.location_id, e.status, e.acceptance_id INTO v_location, v_status, v_acceptance
    FROM "commercial_spaquatoria_gift_eligibility" e WHERE e.id = NEW.eligibility_id FOR SHARE;
  SELECT d.location_id, p.code, a.revoked_at, d.status, d.revoked_at
    INTO STRICT v_assignment_location, v_product_code, v_assignment_revoked, v_device_status, v_device_revoked
    FROM "device_product_assignments" a JOIN "devices" d ON d.id = a.device_id
    JOIN "commercial_products" p ON p.id = a.product_id
    WHERE a.id = NEW.device_product_assignment_id FOR SHARE OF a, d;
  IF v_status IS DISTINCT FROM 'eligible' THEN RAISE EXCEPTION 'Gift Device history requires eligible Location evidence'; END IF;
  IF v_product_code IS DISTINCT FROM 'spaquatoria' THEN RAISE EXCEPTION 'Gift Device history must reference a Spaquatoria assignment'; END IF;
  IF v_assignment_location IS DISTINCT FROM v_location THEN RAISE EXCEPTION 'Gift Device history must reference a Device in the eligible Location'; END IF;
  IF NEW.action = 'assigned' AND (v_assignment_revoked IS NOT NULL OR v_device_status IS DISTINCT FROM 'active' OR v_device_revoked IS NOT NULL) THEN
    RAISE EXCEPTION 'Gift assignment event requires an active Device and assignment';
  END IF;
  IF NEW.action IN ('revoked','replaced') AND v_assignment_revoked IS NULL THEN
    RAISE EXCEPTION 'Gift revocation or replacement event must retain a revoked assignment';
  END IF;
  IF EXISTS (SELECT 1 FROM "commercial_agreement_acceptance_events" e WHERE e.acceptance_id = v_acceptance) THEN
    RAISE EXCEPTION 'Gift Device history cannot rely on a revoked acceptance';
  END IF;
  SELECT v.status INTO v_document_status FROM "commercial_legal_document_versions" v
    JOIN "commercial_agreement_acceptances" a ON a.document_version_id = v.id
    JOIN "commercial_legal_documents" d ON d.id = v.document_id
    WHERE a.id = v_acceptance AND d.code = 'spaquatoria-public-performance-license'
      AND d.jurisdiction = 'RU' AND v.withdrawn_at IS NULL;
  IF v_document_status IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'Gift Device history requires the active Spaquatoria public-performance license'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_gift_device_events_guard" BEFORE INSERT OR UPDATE OR DELETE ON "commercial_spaquatoria_gift_device_events" FOR EACH ROW EXECUTE FUNCTION "commercial_spaquatoria_gift_device_event_guard"();--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_gift_device_events_no_truncate" BEFORE TRUNCATE ON "commercial_spaquatoria_gift_device_events" FOR EACH STATEMENT EXECUTE FUNCTION "commercial_legal_reject_history_mutation"();
