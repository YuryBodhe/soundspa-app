CREATE TABLE "commercial_spaquatoria_gift_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"legal_form" text,
	"legal_name" text,
	"tax_id" text,
	"registration_number" text,
	"registered_address" text,
	"physical_address" text,
	"normalized_physical_address" text,
	"representative_name" text,
	"representative_role" text,
	"representative_email" text,
	"representative_phone" text,
	"authority_statement" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_spaquatoria_gift_drafts_status_valid" CHECK ("commercial_spaquatoria_gift_drafts"."status" = 'draft'),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_version_positive" CHECK ("commercial_spaquatoria_gift_drafts"."version" > 0),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_form_valid" CHECK ("commercial_spaquatoria_gift_drafts"."legal_form" IS NULL OR "commercial_spaquatoria_gift_drafts"."legal_form" IN ('ru_legal_entity','ru_individual_entrepreneur')),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_legal_name_length" CHECK ("commercial_spaquatoria_gift_drafts"."legal_name" IS NULL OR length(btrim("commercial_spaquatoria_gift_drafts"."legal_name")) BETWEEN 1 AND 300),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_tax_id_shape" CHECK ("commercial_spaquatoria_gift_drafts"."tax_id" IS NULL OR "commercial_spaquatoria_gift_drafts"."tax_id" ~ '^[0-9]{1,12}$'),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_registration_shape" CHECK ("commercial_spaquatoria_gift_drafts"."registration_number" IS NULL OR "commercial_spaquatoria_gift_drafts"."registration_number" ~ '^[0-9]{1,15}$'),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_registered_address_length" CHECK ("commercial_spaquatoria_gift_drafts"."registered_address" IS NULL OR length(btrim("commercial_spaquatoria_gift_drafts"."registered_address")) BETWEEN 1 AND 1000),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_physical_address_pair" CHECK (("commercial_spaquatoria_gift_drafts"."physical_address" IS NULL AND "commercial_spaquatoria_gift_drafts"."normalized_physical_address" IS NULL) OR ("commercial_spaquatoria_gift_drafts"."physical_address" IS NOT NULL AND length(btrim("commercial_spaquatoria_gift_drafts"."physical_address")) BETWEEN 1 AND 1000 AND "commercial_spaquatoria_gift_drafts"."normalized_physical_address" IS NOT NULL AND length(btrim("commercial_spaquatoria_gift_drafts"."normalized_physical_address")) BETWEEN 1 AND 1200)),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_representative_name_length" CHECK ("commercial_spaquatoria_gift_drafts"."representative_name" IS NULL OR length(btrim("commercial_spaquatoria_gift_drafts"."representative_name")) BETWEEN 1 AND 300),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_representative_role_length" CHECK ("commercial_spaquatoria_gift_drafts"."representative_role" IS NULL OR length(btrim("commercial_spaquatoria_gift_drafts"."representative_role")) BETWEEN 1 AND 200),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_representative_email_shape" CHECK ("commercial_spaquatoria_gift_drafts"."representative_email" IS NULL OR "commercial_spaquatoria_gift_drafts"."representative_email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_representative_phone_length" CHECK ("commercial_spaquatoria_gift_drafts"."representative_phone" IS NULL OR length(btrim("commercial_spaquatoria_gift_drafts"."representative_phone")) BETWEEN 1 AND 64),
	CONSTRAINT "commercial_spaquatoria_gift_drafts_authority_statement_length" CHECK ("commercial_spaquatoria_gift_drafts"."authority_statement" IS NULL OR length(btrim("commercial_spaquatoria_gift_drafts"."authority_statement")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_drafts" ADD CONSTRAINT "commercial_spaquatoria_gift_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_drafts" ADD CONSTRAINT "commercial_spaquatoria_gift_drafts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_gift_drafts" ADD CONSTRAINT "commercial_spaquatoria_gift_drafts_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_drafts_location_unique" ON "commercial_spaquatoria_gift_drafts" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_gift_drafts_id_scope_unique" ON "commercial_spaquatoria_gift_drafts" USING btree ("id","organization_id","location_id");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_gift_drafts_org_updated_idx" ON "commercial_spaquatoria_gift_drafts" USING btree ("organization_id","updated_at");