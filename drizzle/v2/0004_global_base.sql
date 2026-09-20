CREATE TABLE "base_channels" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_channels" ADD CONSTRAINT "base_channels_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "base_channels" ("channel_id")
SELECT "id" FROM "channels" WHERE "slug" = 'spaquatoria'
ON CONFLICT ("channel_id") DO NOTHING;
