CREATE TYPE "public"."monitoring_error_category" AS ENUM('AUTH', 'PLAYBACK', 'MEDIA_FETCH', 'CATALOG_CONFIG');--> statement-breakpoint
CREATE TYPE "public"."monitoring_lane" AS ENUM('music', 'ambient');--> statement-breakpoint
CREATE TYPE "public"."monitoring_lifecycle_event_type" AS ENUM('organization_created', 'organization_deleted', 'location_created', 'location_deleted', 'device_created', 'device_activated', 'device_revoked', 'device_deleted');--> statement-breakpoint
CREATE TABLE "hourly_channel_playback" (
	"bucket_start" timestamp with time zone NOT NULL,
	"device_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"lane" "monitoring_lane" NOT NULL,
	"played_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hourly_channel_playback_pk" PRIMARY KEY("bucket_start","device_id","channel_id","lane"),
	CONSTRAINT "hourly_channel_playback_utc_hour_check" CHECK (date_trunc('hour', "hourly_channel_playback"."bucket_start" AT TIME ZONE 'UTC') = ("hourly_channel_playback"."bucket_start" AT TIME ZONE 'UTC')),
	CONSTRAINT "hourly_channel_playback_seconds_check" CHECK ("hourly_channel_playback"."played_seconds" BETWEEN 0 AND 3600)
);
--> statement-breakpoint
CREATE TABLE "hourly_device_playback" (
	"bucket_start" timestamp with time zone NOT NULL,
	"device_id" uuid NOT NULL,
	"active_playback_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hourly_device_playback_pk" PRIMARY KEY("bucket_start","device_id"),
	CONSTRAINT "hourly_device_playback_utc_hour_check" CHECK (date_trunc('hour', "hourly_device_playback"."bucket_start" AT TIME ZONE 'UTC') = ("hourly_device_playback"."bucket_start" AT TIME ZONE 'UTC')),
	CONSTRAINT "hourly_device_playback_seconds_check" CHECK ("hourly_device_playback"."active_playback_seconds" BETWEEN 0 AND 3600)
);
--> statement-breakpoint
CREATE TABLE "hourly_error_aggregates" (
	"bucket_start" timestamp with time zone NOT NULL,
	"category" "monitoring_error_category" NOT NULL,
	"error_code" text NOT NULL,
	"device_id" uuid,
	"event_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hourly_error_aggregates_utc_hour_check" CHECK (date_trunc('hour', "hourly_error_aggregates"."bucket_start" AT TIME ZONE 'UTC') = ("hourly_error_aggregates"."bucket_start" AT TIME ZONE 'UTC')),
	CONSTRAINT "hourly_error_aggregates_code_check" CHECK ("hourly_error_aggregates"."error_code" ~ '^[A-Z0-9_]{1,64}$'),
	CONSTRAINT "hourly_error_aggregates_count_check" CHECK ("hourly_error_aggregates"."event_count" > 0),
	CONSTRAINT "hourly_error_aggregates_time_check" CHECK ("hourly_error_aggregates"."first_seen_at" <= "hourly_error_aggregates"."last_seen_at")
);
--> statement-breakpoint
CREATE TABLE "monitoring_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "monitoring_lifecycle_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid,
	"organization_name" text,
	"location_id" uuid,
	"location_name" text,
	"device_id" uuid,
	"device_label" text
);
--> statement-breakpoint
ALTER TABLE "device_current_state" ADD COLUMN "music_session_id" uuid;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD COLUMN "music_sequence" bigint;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD COLUMN "ambient_playback_state" "device_playback_state" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD COLUMN "ambient_current_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD COLUMN "ambient_session_id" uuid;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD COLUMN "ambient_sequence" bigint;--> statement-breakpoint
CREATE INDEX "hourly_channel_playback_device_time_idx" ON "hourly_channel_playback" USING btree ("device_id","bucket_start");--> statement-breakpoint
CREATE INDEX "hourly_channel_playback_channel_time_idx" ON "hourly_channel_playback" USING btree ("channel_id","bucket_start");--> statement-breakpoint
CREATE INDEX "hourly_device_playback_device_time_idx" ON "hourly_device_playback" USING btree ("device_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "hourly_error_aggregates_global_unique_idx" ON "hourly_error_aggregates" USING btree ("bucket_start","category","error_code") WHERE "hourly_error_aggregates"."device_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "hourly_error_aggregates_device_unique_idx" ON "hourly_error_aggregates" USING btree ("bucket_start","category","error_code","device_id") WHERE "hourly_error_aggregates"."device_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "hourly_error_aggregates_time_idx" ON "hourly_error_aggregates" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "hourly_error_aggregates_device_time_idx" ON "hourly_error_aggregates" USING btree ("device_id","bucket_start");--> statement-breakpoint
CREATE INDEX "hourly_error_aggregates_category_time_idx" ON "hourly_error_aggregates" USING btree ("category","bucket_start");--> statement-breakpoint
CREATE INDEX "monitoring_lifecycle_events_time_idx" ON "monitoring_lifecycle_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "monitoring_lifecycle_events_org_time_idx" ON "monitoring_lifecycle_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "monitoring_lifecycle_events_location_time_idx" ON "monitoring_lifecycle_events" USING btree ("location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "monitoring_lifecycle_events_device_time_idx" ON "monitoring_lifecycle_events" USING btree ("device_id","occurred_at");--> statement-breakpoint
ALTER TABLE "device_current_state" ADD CONSTRAINT "device_current_state_ambient_current_channel_id_channels_id_fk" FOREIGN KEY ("ambient_current_channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_current_state" ADD CONSTRAINT "device_current_state_music_signal_check" CHECK (("device_current_state"."music_session_id" IS NULL AND "device_current_state"."music_sequence" IS NULL) OR ("device_current_state"."music_session_id" IS NOT NULL AND "device_current_state"."music_sequence" IS NOT NULL AND "device_current_state"."music_sequence" >= 0));--> statement-breakpoint
ALTER TABLE "device_current_state" ADD CONSTRAINT "device_current_state_ambient_signal_check" CHECK (("device_current_state"."ambient_session_id" IS NULL AND "device_current_state"."ambient_sequence" IS NULL) OR ("device_current_state"."ambient_session_id" IS NOT NULL AND "device_current_state"."ambient_sequence" IS NOT NULL AND "device_current_state"."ambient_sequence" >= 0));