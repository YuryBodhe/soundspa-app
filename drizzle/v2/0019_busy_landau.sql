CREATE TABLE "commercial_product_organization_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_operator" text NOT NULL,
	"grant_reason" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_operator" text,
	"revoke_reason" text,
	CONSTRAINT "commercial_product_org_authorizations_grant_operator_nonempty" CHECK (length(btrim("commercial_product_organization_authorizations"."granted_by_operator")) > 0),
	CONSTRAINT "commercial_product_org_authorizations_grant_reason_nonempty" CHECK (length(btrim("commercial_product_organization_authorizations"."grant_reason")) BETWEEN 1 AND 500),
	CONSTRAINT "commercial_product_org_authorizations_revoke_shape" CHECK (("commercial_product_organization_authorizations"."revoked_at" IS NULL AND "commercial_product_organization_authorizations"."revoked_by_operator" IS NULL AND "commercial_product_organization_authorizations"."revoke_reason" IS NULL) OR ("commercial_product_organization_authorizations"."revoked_at" IS NOT NULL AND "commercial_product_organization_authorizations"."revoked_by_operator" IS NOT NULL AND length(btrim("commercial_product_organization_authorizations"."revoked_by_operator")) > 0 AND "commercial_product_organization_authorizations"."revoke_reason" IS NOT NULL AND length(btrim("commercial_product_organization_authorizations"."revoke_reason")) BETWEEN 1 AND 500 AND "commercial_product_organization_authorizations"."revoked_at" >= "commercial_product_organization_authorizations"."granted_at"))
);
--> statement-breakpoint
ALTER TABLE "commercial_products" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD CONSTRAINT "commercial_product_organization_authorizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD CONSTRAINT "commercial_product_organization_authorizations_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_product_org_authorizations_active_unique" ON "commercial_product_organization_authorizations" USING btree ("organization_id","product_id") WHERE "commercial_product_organization_authorizations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "commercial_product_org_authorizations_history_idx" ON "commercial_product_organization_authorizations" USING btree ("organization_id","product_id","granted_at");--> statement-breakpoint
ALTER TABLE "commercial_products" ADD CONSTRAINT "commercial_products_visibility_valid" CHECK ("commercial_products"."visibility" IN ('public', 'private', 'disabled'));