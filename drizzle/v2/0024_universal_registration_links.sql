ALTER TABLE "commercial_registration_links" DROP CONSTRAINT "commercial_registration_links_policy_valid";--> statement-breakpoint
ALTER TABLE "commercial_registration_links" ADD CONSTRAINT "commercial_registration_links_policy_valid" CHECK (
	jsonb_typeof("policy_snapshot") = 'object' AND "policy_snapshot"->>'policyKey' = "policy_key" AND "policy_snapshot"->>'policyVersion' = "policy_version"::text AND (
		("policy_key" = 'divnitsa' AND "policy_version" = 1 AND "policy_snapshot"->>'basicProductId' ~ '^[0-9a-f-]{36}$' AND "policy_snapshot"->>'divnitsaProductId' ~ '^[0-9a-f-]{36}$' AND "policy_snapshot"->>'basicTrialDays' = '30' AND "policy_snapshot"->>'divnitsaTrialDays' = '30') OR
		("policy_key" = 'universal' AND "policy_version" = 1 AND jsonb_typeof("policy_snapshot"->'products') = 'array' AND jsonb_array_length("policy_snapshot"->'products') BETWEEN 1 AND 3)
	)
);--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_redemptions_id_org_location_unique" ON "commercial_registration_link_redemptions" USING btree ("id", "organization_id", "first_location_id");--> statement-breakpoint
CREATE TABLE "commercial_registration_link_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"redemption_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"partner_id" uuid,
	"access_type" text NOT NULL,
	"duration_months" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_registration_link_grants_access_type_valid" CHECK ("access_type" IN ('trial', 'partner_benefit')),
	CONSTRAINT "commercial_registration_link_grants_partner_access_shape" CHECK (("access_type" = 'trial' AND "partner_id" IS NULL) OR ("access_type" = 'partner_benefit' AND "partner_id" IS NOT NULL)),
	CONSTRAINT "commercial_registration_link_grants_duration_valid" CHECK ("duration_months" BETWEEN 1 AND 12),
	CONSTRAINT "commercial_registration_link_grants_window" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_grants_redemption_product_unique" ON "commercial_registration_link_grants" USING btree ("redemption_id", "product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_grants_id_product_location_unique" ON "commercial_registration_link_grants" USING btree ("id", "product_id", "location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_grants_id_partner_product_location_unique" ON "commercial_registration_link_grants" USING btree ("id", "partner_id", "product_id", "location_id");--> statement-breakpoint
CREATE INDEX "commercial_registration_link_grants_org_location_idx" ON "commercial_registration_link_grants" USING btree ("organization_id", "location_id");--> statement-breakpoint
ALTER TABLE "commercial_registration_link_grants" ADD CONSTRAINT "commercial_registration_link_grants_redemption_scope_fk" FOREIGN KEY ("redemption_id", "organization_id", "location_id") REFERENCES "public"."commercial_registration_link_redemptions"("id", "organization_id", "first_location_id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_grants" ADD CONSTRAINT "commercial_registration_link_grants_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "commercial_partner_benefits" ADD COLUMN "registration_link_grant_id" uuid;--> statement-breakpoint
CREATE INDEX "commercial_partner_benefits_registration_link_grant_idx" ON "commercial_partner_benefits" USING btree ("registration_link_grant_id");--> statement-breakpoint
ALTER TABLE "commercial_partner_benefits" ADD CONSTRAINT "commercial_partner_benefits_registration_link_grant_fk" FOREIGN KEY ("registration_link_grant_id", "partner_id", "product_id", "location_id") REFERENCES "public"."commercial_registration_link_grants"("id", "partner_id", "product_id", "location_id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "commercial_partner_benefits" ADD CONSTRAINT "commercial_partner_benefits_promo_registration_source_exclusive" CHECK ("promo_redemption_id" IS NULL OR "registration_link_grant_id" IS NULL);--> statement-breakpoint
ALTER TABLE "location_core_trials" ADD COLUMN "registration_link_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "location_core_trials" ADD CONSTRAINT "location_core_trials_registration_link_grant_fk" FOREIGN KEY ("registration_link_grant_id", "product_id", "location_id") REFERENCES "public"."commercial_registration_link_grants"("id", "product_id", "location_id") ON DELETE RESTRICT ON UPDATE NO ACTION;--> statement-breakpoint
CREATE TRIGGER "commercial_registration_link_grants_append_only" BEFORE UPDATE OR DELETE ON "commercial_registration_link_grants" FOR EACH ROW EXECUTE FUNCTION "reject_registration_link_history_mutation"();--> statement-breakpoint
CREATE TRIGGER "commercial_registration_link_grants_no_truncate" BEFORE TRUNCATE ON "commercial_registration_link_grants" FOR EACH STATEMENT EXECUTE FUNCTION "reject_registration_link_history_mutation"();
