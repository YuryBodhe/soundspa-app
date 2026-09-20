CREATE TABLE "location_channel_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_channel_grants_source" CHECK ("source" = 'admin'),
	CONSTRAINT "location_channel_grants_window" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "location_channel_grants" ADD CONSTRAINT "location_channel_grants_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "location_channel_grants" ADD CONSTRAINT "location_channel_grants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "location_channel_grants_unique_source" ON "location_channel_grants" USING btree ("location_id","channel_id","source");
--> statement-breakpoint
CREATE INDEX "location_channel_grants_channel_idx" ON "location_channel_grants" USING btree ("channel_id");
