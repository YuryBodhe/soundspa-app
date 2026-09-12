CREATE TYPE "public"."channel_kind" AS ENUM('music', 'ambient');--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"description" text,
	"image_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_slug_unique" UNIQUE("slug"),
	CONSTRAINT "channels_display_name_nonempty" CHECK (length(btrim("channels"."display_name")) > 0),
	CONSTRAINT "channels_slug_format" CHECK ("channels"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "channels_sort_order_nonnegative" CHECK ("channels"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "channel_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sort_order" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_tracks_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "channel_tracks_size_positive" CHECK ("channel_tracks"."size_bytes" > 0),
	CONSTRAINT "channel_tracks_sort_order_nonnegative" CHECK ("channel_tracks"."sort_order" >= 0),
	CONSTRAINT "channel_tracks_storage_key_nonempty" CHECK (length(btrim("channel_tracks"."storage_key")) > 0),
	CONSTRAINT "channel_tracks_original_filename_nonempty" CHECK (length(btrim("channel_tracks"."original_filename")) > 0)
);
--> statement-breakpoint
ALTER TABLE "channel_tracks" ADD CONSTRAINT "channel_tracks_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_catalog_idx" ON "channels" USING btree ("kind","is_published","sort_order");--> statement-breakpoint
CREATE INDEX "channel_tracks_playlist_idx" ON "channel_tracks" USING btree ("channel_id","sort_order","id");