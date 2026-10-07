CREATE TABLE "customer_auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid,
	"signup_intent_id" uuid,
	"locale" text DEFAULT 'en' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_auth_tokens_hash_sha256" CHECK ("customer_auth_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_auth_tokens_purpose_valid" CHECK ("customer_auth_tokens"."purpose" IN ('verify_email', 'login_link')),
	CONSTRAINT "customer_auth_tokens_target_valid" CHECK (("customer_auth_tokens"."purpose" = 'verify_email' AND "customer_auth_tokens"."signup_intent_id" IS NOT NULL) OR ("customer_auth_tokens"."purpose" = 'login_link' AND "customer_auth_tokens"."user_id" IS NOT NULL)),
	CONSTRAINT "customer_auth_tokens_locale_supported" CHECK ("customer_auth_tokens"."locale" IN ('en', 'ru', 'vi', 'th'))
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"signup_intent_id" uuid,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "customer_sessions_hash_sha256" CHECK ("customer_sessions"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "customer_signup_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"invite_token_hash" text,
	"context_token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_signup_intents_locale_supported" CHECK ("customer_signup_intents"."locale" IN ('en', 'ru', 'vi', 'th')),
	CONSTRAINT "customer_signup_intents_email_normalized" CHECK ("customer_signup_intents"."email" IS NULL OR ("customer_signup_intents"."email" = lower(btrim("customer_signup_intents"."email")) AND length("customer_signup_intents"."email") > 0)),
	CONSTRAINT "customer_signup_intents_invite_hash_sha256" CHECK ("customer_signup_intents"."invite_token_hash" IS NULL OR "customer_signup_intents"."invite_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_signup_intents_context_hash_sha256" CHECK ("customer_signup_intents"."context_token_hash" IS NULL OR "customer_signup_intents"."context_token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_locale" text;--> statement-breakpoint
ALTER TABLE "customer_auth_tokens" ADD CONSTRAINT "customer_auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_auth_tokens" ADD CONSTRAINT "customer_auth_tokens_signup_intent_id_customer_signup_intents_id_fk" FOREIGN KEY ("signup_intent_id") REFERENCES "public"."customer_signup_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_signup_intent_id_customer_signup_intents_id_fk" FOREIGN KEY ("signup_intent_id") REFERENCES "public"."customer_signup_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_auth_tokens_token_hash_unique" ON "customer_auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_auth_tokens_user_idx" ON "customer_auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customer_auth_tokens_intent_idx" ON "customer_auth_tokens" USING btree ("signup_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sessions_token_hash_unique" ON "customer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_sessions_user_idx" ON "customer_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_signup_intents_context_token_hash_unique" ON "customer_signup_intents" USING btree ("context_token_hash");--> statement-breakpoint
CREATE INDEX "customer_signup_intents_email_idx" ON "customer_signup_intents" USING btree ("email");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_locale_supported" CHECK ("users"."preferred_locale" IS NULL OR "users"."preferred_locale" IN ('en', 'ru', 'vi', 'th'));