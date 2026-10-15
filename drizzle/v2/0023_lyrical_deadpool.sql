CREATE TABLE "commercial_spaquatoria_promo_code_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"action" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_spaquatoria_promo_code_events_action_valid" CHECK ("commercial_spaquatoria_promo_code_events"."action" IN ('created', 'configured', 'revoked')),
	CONSTRAINT "commercial_spaquatoria_promo_code_events_operator_nonempty" CHECK (length(btrim("commercial_spaquatoria_promo_code_events"."operator")) > 0),
	CONSTRAINT "commercial_spaquatoria_promo_code_events_reason_nonempty" CHECK (length(btrim("commercial_spaquatoria_promo_code_events"."reason")) BETWEEN 12 AND 500),
	CONSTRAINT "commercial_spaquatoria_promo_code_events_state_shape" CHECK (jsonb_typeof("commercial_spaquatoria_promo_code_events"."after_state") = 'object' AND ("commercial_spaquatoria_promo_code_events"."before_state" IS NULL OR jsonb_typeof("commercial_spaquatoria_promo_code_events"."before_state") = 'object') AND (("commercial_spaquatoria_promo_code_events"."action" = 'created' AND "commercial_spaquatoria_promo_code_events"."before_state" IS NULL) OR ("commercial_spaquatoria_promo_code_events"."action" <> 'created' AND "commercial_spaquatoria_promo_code_events"."before_state" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "commercial_spaquatoria_promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"duration_days" integer NOT NULL,
	"created_by_operator" text NOT NULL,
	"creation_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"revoked_at" timestamp with time zone,
	"revoked_by_operator" text,
	"revoke_reason" text,
	CONSTRAINT "commercial_spaquatoria_promo_codes_token_hash_sha256" CHECK ("commercial_spaquatoria_promo_codes"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commercial_spaquatoria_promo_codes_duration_valid" CHECK ("commercial_spaquatoria_promo_codes"."duration_days" BETWEEN 1 AND 365),
	CONSTRAINT "commercial_spaquatoria_promo_codes_operator_nonempty" CHECK (length(btrim("commercial_spaquatoria_promo_codes"."created_by_operator")) > 0),
	CONSTRAINT "commercial_spaquatoria_promo_codes_reason_nonempty" CHECK (length(btrim("commercial_spaquatoria_promo_codes"."creation_reason")) BETWEEN 12 AND 500),
	CONSTRAINT "commercial_spaquatoria_promo_codes_max_redemptions_positive" CHECK ("commercial_spaquatoria_promo_codes"."max_redemptions" IS NULL OR "commercial_spaquatoria_promo_codes"."max_redemptions" > 0),
	CONSTRAINT "commercial_spaquatoria_promo_codes_expiry_after_creation" CHECK ("commercial_spaquatoria_promo_codes"."expires_at" IS NULL OR "commercial_spaquatoria_promo_codes"."expires_at" > "commercial_spaquatoria_promo_codes"."created_at"),
	CONSTRAINT "commercial_spaquatoria_promo_codes_revoke_shape" CHECK (("commercial_spaquatoria_promo_codes"."revoked_at" IS NULL AND "commercial_spaquatoria_promo_codes"."revoked_by_operator" IS NULL AND "commercial_spaquatoria_promo_codes"."revoke_reason" IS NULL) OR ("commercial_spaquatoria_promo_codes"."revoked_at" IS NOT NULL AND "commercial_spaquatoria_promo_codes"."revoked_by_operator" IS NOT NULL AND length(btrim("commercial_spaquatoria_promo_codes"."revoked_by_operator")) > 0 AND "commercial_spaquatoria_promo_codes"."revoke_reason" IS NOT NULL AND length(btrim("commercial_spaquatoria_promo_codes"."revoke_reason")) BETWEEN 12 AND 500 AND "commercial_spaquatoria_promo_codes"."revoked_at" >= "commercial_spaquatoria_promo_codes"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "commercial_spaquatoria_promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"verified_user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"requested_duration_days" integer NOT NULL,
	"granted_duration_ms" bigint NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_spaquatoria_promo_redemptions_requested_duration_valid" CHECK ("commercial_spaquatoria_promo_redemptions"."requested_duration_days" BETWEEN 1 AND 365),
	CONSTRAINT "commercial_spaquatoria_promo_redemptions_granted_duration_valid" CHECK ("commercial_spaquatoria_promo_redemptions"."granted_duration_ms" BETWEEN 1 AND "commercial_spaquatoria_promo_redemptions"."requested_duration_days"::bigint * 86400000)
);
--> statement-breakpoint
ALTER TABLE "commercial_partner_benefits" ADD COLUMN "promo_redemption_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_code_events" ADD CONSTRAINT "commercial_spaquatoria_promo_code_events_promo_code_id_commercial_spaquatoria_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."commercial_spaquatoria_promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_codes" ADD CONSTRAINT "commercial_spaquatoria_promo_codes_partner_id_commercial_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."commercial_partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_codes" ADD CONSTRAINT "commercial_spaquatoria_promo_codes_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_redemptions" ADD CONSTRAINT "commercial_spaquatoria_promo_redemptions_promo_code_id_commercial_spaquatoria_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."commercial_spaquatoria_promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_redemptions" ADD CONSTRAINT "commercial_spaquatoria_promo_redemptions_verified_user_id_users_id_fk" FOREIGN KEY ("verified_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_redemptions" ADD CONSTRAINT "commercial_spaquatoria_promo_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_redemptions" ADD CONSTRAINT "commercial_spaquatoria_promo_redemptions_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_promo_code_events_code_time_idx" ON "commercial_spaquatoria_promo_code_events" USING btree ("promo_code_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_promo_code_events_created_unique" ON "commercial_spaquatoria_promo_code_events" USING btree ("promo_code_id") WHERE "commercial_spaquatoria_promo_code_events"."action" = 'created';--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_promo_code_events_revoked_unique" ON "commercial_spaquatoria_promo_code_events" USING btree ("promo_code_id") WHERE "commercial_spaquatoria_promo_code_events"."action" = 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_promo_codes_token_hash_unique" ON "commercial_spaquatoria_promo_codes" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_promo_codes_id_scope_unique" ON "commercial_spaquatoria_promo_codes" USING btree ("id","partner_id","product_id");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_promo_codes_status_idx" ON "commercial_spaquatoria_promo_codes" USING btree ("created_at","expires_at","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_promo_redemptions_code_location_unique" ON "commercial_spaquatoria_promo_redemptions" USING btree ("promo_code_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_spaquatoria_promo_redemptions_id_scope_unique" ON "commercial_spaquatoria_promo_redemptions" USING btree ("id","partner_id","product_id","location_id");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_promo_redemptions_code_time_idx" ON "commercial_spaquatoria_promo_redemptions" USING btree ("promo_code_id","redeemed_at");--> statement-breakpoint
CREATE INDEX "commercial_spaquatoria_promo_redemptions_org_idx" ON "commercial_spaquatoria_promo_redemptions" USING btree ("organization_id","location_id");--> statement-breakpoint
CREATE INDEX "commercial_partner_benefits_promo_redemption_idx" ON "commercial_partner_benefits" USING btree ("promo_redemption_id");--> statement-breakpoint
-- Composite foreign keys target unique indexes created above by Drizzle. Add
-- them after the indexes exist so a fresh PostgreSQL migration can execute.
ALTER TABLE "commercial_spaquatoria_promo_redemptions" ADD CONSTRAINT "commercial_spaquatoria_promo_redemptions_code_scope_fk" FOREIGN KEY ("promo_code_id","partner_id","product_id") REFERENCES "public"."commercial_spaquatoria_promo_codes"("id","partner_id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_partner_benefits" ADD CONSTRAINT "commercial_partner_benefits_promo_redemption_fk" FOREIGN KEY ("promo_redemption_id","partner_id","product_id","location_id") REFERENCES "public"."commercial_spaquatoria_promo_redemptions"("id","partner_id","product_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "reject_spaquatoria_promo_history_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Spaquatoria promo history is append-only';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_promo_code_events_append_only" BEFORE UPDATE OR DELETE ON "commercial_spaquatoria_promo_code_events" FOR EACH ROW EXECUTE FUNCTION "reject_spaquatoria_promo_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_promo_code_events_no_truncate" BEFORE TRUNCATE ON "commercial_spaquatoria_promo_code_events" FOR EACH STATEMENT EXECUTE FUNCTION "reject_spaquatoria_promo_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_promo_redemptions_append_only" BEFORE UPDATE OR DELETE ON "commercial_spaquatoria_promo_redemptions" FOR EACH ROW EXECUTE FUNCTION "reject_spaquatoria_promo_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_promo_redemptions_no_truncate" BEFORE TRUNCATE ON "commercial_spaquatoria_promo_redemptions" FOR EACH STATEMENT EXECUTE FUNCTION "reject_spaquatoria_promo_history_mutation"();
--> statement-breakpoint
CREATE FUNCTION "protect_spaquatoria_promo_code_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."id" IS DISTINCT FROM NEW."id" OR OLD."token_hash" IS DISTINCT FROM NEW."token_hash" OR OLD."partner_id" IS DISTINCT FROM NEW."partner_id" OR OLD."product_id" IS DISTINCT FROM NEW."product_id" OR OLD."created_by_operator" IS DISTINCT FROM NEW."created_by_operator" OR OLD."creation_reason" IS DISTINCT FROM NEW."creation_reason" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
		RAISE EXCEPTION 'Spaquatoria promo code identity is immutable';
	END IF;
	IF OLD."revoked_at" IS NOT NULL AND (OLD."revoked_at" IS DISTINCT FROM NEW."revoked_at" OR OLD."revoked_by_operator" IS DISTINCT FROM NEW."revoked_by_operator" OR OLD."revoke_reason" IS DISTINCT FROM NEW."revoke_reason") THEN
		RAISE EXCEPTION 'Spaquatoria promo code revocation is final';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_spaquatoria_promo_codes_identity_immutable" BEFORE UPDATE ON "commercial_spaquatoria_promo_codes" FOR EACH ROW EXECUTE FUNCTION "protect_spaquatoria_promo_code_identity"();
--> statement-breakpoint
ALTER TABLE "commercial_spaquatoria_promo_codes" ENABLE ALWAYS TRIGGER "commercial_spaquatoria_promo_codes_identity_immutable";
