CREATE TYPE "public"."device_event_type" AS ENUM('session_started', 'playback_started', 'playback_stopped', 'channel_changed', 'playback_error', 'player_recovered');--> statement-breakpoint
CREATE TYPE "public"."device_playback_state" AS ENUM('idle', 'playing', 'paused', 'buffering', 'error');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"status" "device_status" DEFAULT 'active' NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_current_state" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_playback_at" timestamp with time zone,
	"playback_state" "device_playback_state" DEFAULT 'idle' NOT NULL,
	"current_channel_id" uuid,
	"client_version" text,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"event_type" "device_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel_id" uuid,
	"details" jsonb,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD CONSTRAINT "device_current_state_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD CONSTRAINT "device_current_state_current_channel_id_channels_id_fk" FOREIGN KEY ("current_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_credential_hash_unique" ON "devices" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "devices_location_idx" ON "devices" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "devices_location_revoked_idx" ON "devices" USING btree ("location_id","revoked_at");--> statement-breakpoint
CREATE INDEX "device_current_state_last_seen_idx" ON "device_current_state" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "device_events_processing_idx" ON "device_events" USING btree ("processed_at","occurred_at");--> statement-breakpoint
CREATE INDEX "device_events_device_time_idx" ON "device_events" USING btree ("device_id","occurred_at");