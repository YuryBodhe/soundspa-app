CREATE TYPE "public"."entitlement_type" AS ENUM('included', 'preview', 'subscribed');--> statement-breakpoint
CREATE TABLE "location_service_access" (
	"location_id" uuid PRIMARY KEY NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"paid_through" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_channel_entitlements" (
	"location_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"access_type" "entitlement_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_channel_entitlements_location_id_channel_id_pk" PRIMARY KEY("location_id","channel_id"),
	CONSTRAINT "location_channel_entitlements_preview_expiry" CHECK ("location_channel_entitlements"."access_type" <> 'preview' OR "location_channel_entitlements"."expires_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "location_service_access" ADD CONSTRAINT "location_service_access_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_channel_entitlements" ADD CONSTRAINT "location_channel_entitlements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_channel_entitlements" ADD CONSTRAINT "location_channel_entitlements_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_channel_entitlements_channel_idx" ON "location_channel_entitlements" USING btree ("channel_id");