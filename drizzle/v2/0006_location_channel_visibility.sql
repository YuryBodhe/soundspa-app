CREATE TABLE "location_channel_visibility" (
	"location_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"hidden" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_channel_visibility_location_id_channel_id_pk" PRIMARY KEY("location_id","channel_id"),
	CONSTRAINT "location_channel_visibility_hidden_only" CHECK ("location_channel_visibility"."hidden" IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "location_channel_visibility" ADD CONSTRAINT "location_channel_visibility_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "location_channel_visibility" ADD CONSTRAINT "location_channel_visibility_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
