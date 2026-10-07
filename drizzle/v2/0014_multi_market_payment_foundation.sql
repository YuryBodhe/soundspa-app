CREATE TABLE "commercial_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_code" text NOT NULL,
	"payment_id" uuid,
	"external_event_id" text,
	"payment_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_payment_events_key_nonempty" CHECK (length(btrim("commercial_payment_events"."idempotency_key")) > 0),
	CONSTRAINT "commercial_payment_events_payment_key_nonempty" CHECK (length(btrim("commercial_payment_events"."payment_key")) > 0),
	CONSTRAINT "commercial_payment_events_status_valid" CHECK ("commercial_payment_events"."status" IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded'))
);
--> statement-breakpoint
CREATE TABLE "commercial_payment_providers" (
	"code" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_payment_providers_code_format" CHECK ("commercial_payment_providers"."code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "commercial_payment_providers_name_nonempty" CHECK (length(btrim("commercial_payment_providers"."display_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_payment_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"provider_code" text NOT NULL,
	"external_reference" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_payment_routes_market_format" CHECK ("commercial_payment_routes"."market_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "commercial_payment_routes_external_reference_nonempty" CHECK (length(btrim("commercial_payment_routes"."external_reference")) > 0),
	CONSTRAINT "commercial_payment_routes_display_order_nonnegative" CHECK ("commercial_payment_routes"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"subscription_id" uuid,
	"route_id" uuid,
	"provider_code" text NOT NULL,
	"payment_key" text NOT NULL,
	"external_payment_id" text,
	"external_subscription_ref" text,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"provider_occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_payments_key_nonempty" CHECK (length(btrim("commercial_payments"."payment_key")) > 0),
	CONSTRAINT "commercial_payments_status_valid" CHECK ("commercial_payments"."status" IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded')),
	CONSTRAINT "commercial_payments_amount_nonnegative" CHECK ("commercial_payments"."amount_minor" >= 0),
	CONSTRAINT "commercial_payments_currency_format" CHECK ("commercial_payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "commercial_organization_payer_references" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "location_subscriptions" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
INSERT INTO "commercial_payment_providers" ("code", "display_name", "is_enabled")
SELECT DISTINCT provider, provider, false
FROM (
	SELECT "provider"::text AS provider FROM "commercial_organization_payer_references"
	UNION
	SELECT "provider"::text AS provider FROM "location_subscriptions"
) existing_providers
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "market_code" text;--> statement-breakpoint
ALTER TABLE "commercial_payment_events" ADD CONSTRAINT "commercial_payment_events_provider_code_commercial_payment_providers_code_fk" FOREIGN KEY ("provider_code") REFERENCES "public"."commercial_payment_providers"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payment_events" ADD CONSTRAINT "commercial_payment_events_payment_id_commercial_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."commercial_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payment_routes" ADD CONSTRAINT "commercial_payment_routes_provider_code_commercial_payment_providers_code_fk" FOREIGN KEY ("provider_code") REFERENCES "public"."commercial_payment_providers"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payment_routes" ADD CONSTRAINT "commercial_payment_routes_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_provider_code_commercial_payment_providers_code_fk" FOREIGN KEY ("provider_code") REFERENCES "public"."commercial_payment_providers"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."location_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_payments" ADD CONSTRAINT "commercial_payments_route_fk" FOREIGN KEY ("route_id") REFERENCES "public"."commercial_payment_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payment_events_provider_key_unique" ON "commercial_payment_events" USING btree ("provider_code","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payment_events_provider_external_id_unique" ON "commercial_payment_events" USING btree ("provider_code","external_event_id") WHERE "commercial_payment_events"."external_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "commercial_payment_events_payment_idx" ON "commercial_payment_events" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payment_routes_external_ref_unique" ON "commercial_payment_routes" USING btree ("market_code","product_id","provider_code","external_reference");--> statement-breakpoint
CREATE INDEX "commercial_payment_routes_lookup_idx" ON "commercial_payment_routes" USING btree ("market_code","product_id","is_enabled","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payments_provider_key_unique" ON "commercial_payments" USING btree ("provider_code","payment_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_payments_provider_external_id_unique" ON "commercial_payments" USING btree ("provider_code","external_payment_id") WHERE "commercial_payments"."external_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "commercial_payments_location_created_idx" ON "commercial_payments" USING btree ("location_id","created_at");--> statement-breakpoint
ALTER TABLE "commercial_organization_payer_references" ADD CONSTRAINT "commercial_organization_payer_references_provider_commercial_payment_providers_code_fk" FOREIGN KEY ("provider") REFERENCES "public"."commercial_payment_providers"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_subscriptions" ADD CONSTRAINT "location_subscriptions_provider_commercial_payment_providers_code_fk" FOREIGN KEY ("provider") REFERENCES "public"."commercial_payment_providers"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_market_code_format" CHECK ("locations"."market_code" IS NULL OR "locations"."market_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
DROP TYPE "public"."commercial_provider";
