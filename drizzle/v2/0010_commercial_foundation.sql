CREATE TYPE "commercial_product_kind" AS ENUM ('core', 'partner', 'addon');--> statement-breakpoint
CREATE TYPE "commercial_trial_status" AS ENUM ('active', 'expired');--> statement-breakpoint
CREATE TYPE "commercial_subscription_status" AS ENUM ('active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "commercial_provider" AS ENUM ('manual', 'staging', 'prodamus');--> statement-breakpoint
CREATE TABLE "commercial_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "kind" "commercial_product_kind" NOT NULL,
  "price_minor" integer,
  "currency" text,
  "billing_interval_months" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_products_name_nonempty" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "commercial_products_price_pair" CHECK (("price_minor" IS NULL AND "currency" IS NULL) OR ("price_minor" >= 0 AND "currency" IS NOT NULL AND length(btrim("currency")) = 3)),
  CONSTRAINT "commercial_products_interval_positive" CHECK ("billing_interval_months" IS NULL OR "billing_interval_months" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_products_code_unique" ON "commercial_products" USING btree ("code");--> statement-breakpoint
CREATE TABLE "commercial_product_channels" (
  "product_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_product_channels_product_id_channel_id_pk" PRIMARY KEY("product_id","channel_id"),
  CONSTRAINT "commercial_product_channels_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "commercial_products"("id") ON DELETE restrict,
  CONSTRAINT "commercial_product_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE restrict
);--> statement-breakpoint
CREATE TABLE "commercial_partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_partners_name_nonempty" CHECK (length(btrim("name")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_partners_code_unique" ON "commercial_partners" USING btree ("code");--> statement-breakpoint
CREATE TABLE "commercial_partner_benefits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_partner_benefits_partner_fk" FOREIGN KEY ("partner_id") REFERENCES "commercial_partners"("id") ON DELETE restrict,
  CONSTRAINT "commercial_partner_benefits_product_fk" FOREIGN KEY ("product_id") REFERENCES "commercial_products"("id") ON DELETE restrict,
  CONSTRAINT "commercial_partner_benefits_location_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE restrict,
  CONSTRAINT "commercial_partner_benefits_window" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_partner_benefits_unique_period" ON "commercial_partner_benefits" USING btree ("partner_id","product_id","location_id","starts_at");--> statement-breakpoint
CREATE TABLE "location_core_trials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "status" "commercial_trial_status" NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "location_core_trials_location_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE restrict,
  CONSTRAINT "location_core_trials_product_fk" FOREIGN KEY ("product_id") REFERENCES "commercial_products"("id") ON DELETE restrict,
  CONSTRAINT "location_core_trials_window" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "location_core_trials_location_product_unique" ON "location_core_trials" USING btree ("location_id","product_id");--> statement-breakpoint
CREATE TABLE "location_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "location_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "provider" "commercial_provider" NOT NULL,
  "status" "commercial_subscription_status" NOT NULL,
  "provider_customer_ref" text,
  "provider_subscription_ref" text,
  "starts_at" timestamptz NOT NULL,
  "current_period_ends_at" timestamptz,
  "canceled_at" timestamptz,
  "price_minor" integer,
  "currency" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "location_subscriptions_location_fk" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE restrict,
  CONSTRAINT "location_subscriptions_product_fk" FOREIGN KEY ("product_id") REFERENCES "commercial_products"("id") ON DELETE restrict,
  CONSTRAINT "location_subscriptions_price_pair" CHECK (("price_minor" IS NULL AND "currency" IS NULL) OR ("price_minor" >= 0 AND "currency" IS NOT NULL AND length(btrim("currency")) = 3)),
  CONSTRAINT "location_subscriptions_period_after_start" CHECK ("current_period_ends_at" IS NULL OR "current_period_ends_at" > "starts_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "location_subscriptions_provider_ref_unique" ON "location_subscriptions" USING btree ("provider","provider_subscription_ref");--> statement-breakpoint
CREATE TABLE "commercial_organization_payer_references" (
  "organization_id" uuid PRIMARY KEY,
  "provider" "commercial_provider" NOT NULL,
  "provider_customer_ref" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_organization_payer_references_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict
);
