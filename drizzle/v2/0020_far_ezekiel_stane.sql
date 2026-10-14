CREATE TABLE "commercial_product_visibility_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"previous_visibility" text NOT NULL,
	"new_visibility" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_product_visibility_events_visibility_valid" CHECK ("commercial_product_visibility_events"."previous_visibility" IN ('public', 'private', 'disabled') AND "commercial_product_visibility_events"."new_visibility" IN ('public', 'private', 'disabled') AND "commercial_product_visibility_events"."previous_visibility" <> "commercial_product_visibility_events"."new_visibility"),
	CONSTRAINT "commercial_product_visibility_events_operator_nonempty" CHECK (length(btrim("commercial_product_visibility_events"."operator")) > 0),
	CONSTRAINT "commercial_product_visibility_events_reason_nonempty" CHECK (length(btrim("commercial_product_visibility_events"."reason")) BETWEEN 12 AND 500)
);
--> statement-breakpoint
ALTER TABLE "commercial_product_visibility_events" ADD CONSTRAINT "commercial_product_visibility_events_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_product_visibility_events_product_time_idx" ON "commercial_product_visibility_events" USING btree ("product_id","changed_at");