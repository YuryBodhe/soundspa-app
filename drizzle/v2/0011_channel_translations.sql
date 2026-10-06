CREATE TABLE IF NOT EXISTS "channel_translations" (
  "channel_id" uuid NOT NULL,
  "locale" text NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "channel_translations_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE,
  CONSTRAINT "channel_translations_locale_format" CHECK ("locale" ~ '^[a-z]{2,8}(-[a-z]{2,8})?$'),
  CONSTRAINT "channel_translations_title_nonempty" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "channel_translations_pk" PRIMARY KEY ("channel_id", "locale")
);
CREATE INDEX IF NOT EXISTS "channel_translations_locale_idx" ON "channel_translations" ("locale");
