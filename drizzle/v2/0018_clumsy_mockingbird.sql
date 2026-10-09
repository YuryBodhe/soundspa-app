CREATE TABLE "commercial_billing_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_ids" uuid[] NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"trial_duration_days" integer NOT NULL,
	"affected_records" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_billing_resets_operator_nonempty" CHECK (length(btrim("commercial_billing_resets"."operator")) > 0),
	CONSTRAINT "commercial_billing_resets_reason_nonempty" CHECK (length(btrim("commercial_billing_resets"."reason")) BETWEEN 12 AND 500),
	CONSTRAINT "commercial_billing_resets_trial_duration" CHECK ("commercial_billing_resets"."trial_duration_days" BETWEEN 1 AND 365),
	CONSTRAINT "commercial_billing_resets_products_nonempty" CHECK (cardinality("commercial_billing_resets"."product_ids") > 0)
);
--> statement-breakpoint
DROP INDEX "location_core_trials_location_product_unique";--> statement-breakpoint
ALTER TABLE "location_core_trials" ADD COLUMN "invalidated_by_reset_id" uuid;--> statement-breakpoint
ALTER TABLE "location_subscriptions" ADD COLUMN "invalidated_by_reset_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_billing_resets" ADD CONSTRAINT "commercial_billing_resets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_billing_resets" ADD CONSTRAINT "commercial_billing_resets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_billing_resets_location_created_idx" ON "commercial_billing_resets" USING btree ("location_id","created_at");--> statement-breakpoint
ALTER TABLE "location_core_trials" ADD CONSTRAINT "location_core_trials_invalidated_by_reset_id_commercial_billing_resets_id_fk" FOREIGN KEY ("invalidated_by_reset_id") REFERENCES "public"."commercial_billing_resets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_subscriptions" ADD CONSTRAINT "location_subscriptions_invalidated_by_reset_id_commercial_billing_resets_id_fk" FOREIGN KEY ("invalidated_by_reset_id") REFERENCES "public"."commercial_billing_resets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_core_trials_reset_idx" ON "location_core_trials" USING btree ("invalidated_by_reset_id");--> statement-breakpoint
CREATE INDEX "location_subscriptions_reset_idx" ON "location_subscriptions" USING btree ("invalidated_by_reset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "location_core_trials_location_product_unique" ON "location_core_trials" USING btree ("location_id","product_id") WHERE "location_core_trials"."invalidated_by_reset_id" IS NULL;