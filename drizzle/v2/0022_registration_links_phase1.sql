CREATE TABLE "commercial_registration_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_link_id" uuid NOT NULL,
	"action" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_registration_link_events_action_valid" CHECK ("commercial_registration_link_events"."action" IN ('created', 'disabled')),
	CONSTRAINT "commercial_registration_link_events_operator_nonempty" CHECK (length(btrim("commercial_registration_link_events"."operator")) > 0),
	CONSTRAINT "commercial_registration_link_events_reason_nonempty" CHECK (length(btrim("commercial_registration_link_events"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "commercial_registration_link_events_state_shape" CHECK (jsonb_typeof("commercial_registration_link_events"."after_state") = 'object' AND ("commercial_registration_link_events"."before_state" IS NULL OR jsonb_typeof("commercial_registration_link_events"."before_state") = 'object') AND (("commercial_registration_link_events"."action" = 'created' AND "commercial_registration_link_events"."before_state" IS NULL AND "commercial_registration_link_events"."after_state"->>'disabledAt' IS NULL) OR ("commercial_registration_link_events"."action" = 'disabled' AND "commercial_registration_link_events"."before_state" IS NOT NULL AND "commercial_registration_link_events"."before_state"->>'disabledAt' IS NULL AND "commercial_registration_link_events"."after_state"->>'disabledAt' IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "commercial_registration_link_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_link_id" uuid NOT NULL,
	"signup_intent_id" uuid NOT NULL,
	"verified_user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"first_location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_registration_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"policy_key" text NOT NULL,
	"policy_version" integer NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"created_by_operator" text NOT NULL,
	"creation_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"disabled_at" timestamp with time zone,
	"disabled_by_operator" text,
	"disable_reason" text,
	CONSTRAINT "commercial_registration_links_token_hash_sha256" CHECK ("commercial_registration_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commercial_registration_links_policy_valid" CHECK ("commercial_registration_links"."policy_key" = 'divnitsa' AND "commercial_registration_links"."policy_version" = 1 AND jsonb_typeof("commercial_registration_links"."policy_snapshot") = 'object' AND "commercial_registration_links"."policy_snapshot"->>'policyKey' = 'divnitsa' AND "commercial_registration_links"."policy_snapshot"->>'policyVersion' = '1' AND "commercial_registration_links"."policy_snapshot"->>'basicProductId' ~ '^[0-9a-f-]{36}$' AND "commercial_registration_links"."policy_snapshot"->>'divnitsaProductId' ~ '^[0-9a-f-]{36}$' AND "commercial_registration_links"."policy_snapshot"->>'basicTrialDays' = '30' AND "commercial_registration_links"."policy_snapshot"->>'divnitsaTrialDays' = '30'),
	CONSTRAINT "commercial_registration_links_operator_nonempty" CHECK (length(btrim("commercial_registration_links"."created_by_operator")) > 0),
	CONSTRAINT "commercial_registration_links_reason_nonempty" CHECK (length(btrim("commercial_registration_links"."creation_reason")) BETWEEN 1 AND 500),
	CONSTRAINT "commercial_registration_links_max_redemptions_positive" CHECK ("commercial_registration_links"."max_redemptions" IS NULL OR "commercial_registration_links"."max_redemptions" > 0),
	CONSTRAINT "commercial_registration_links_expiry_after_creation" CHECK ("commercial_registration_links"."expires_at" IS NULL OR "commercial_registration_links"."expires_at" > "commercial_registration_links"."created_at"),
	CONSTRAINT "commercial_registration_links_disabled_after_creation" CHECK ("commercial_registration_links"."disabled_at" IS NULL OR "commercial_registration_links"."disabled_at" >= "commercial_registration_links"."created_at"),
	CONSTRAINT "commercial_registration_links_disable_shape" CHECK (("commercial_registration_links"."disabled_at" IS NULL AND "commercial_registration_links"."disabled_by_operator" IS NULL AND "commercial_registration_links"."disable_reason" IS NULL) OR ("commercial_registration_links"."disabled_at" IS NOT NULL AND "commercial_registration_links"."disabled_by_operator" IS NOT NULL AND length(btrim("commercial_registration_links"."disabled_by_operator")) > 0 AND "commercial_registration_links"."disable_reason" IS NOT NULL AND length(btrim("commercial_registration_links"."disable_reason")) BETWEEN 12 AND 500))
);
--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" DROP CONSTRAINT "commercial_product_org_authorizations_grant_operator_nonempty";--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ALTER COLUMN "granted_by_operator" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD COLUMN "grant_source" text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD COLUMN "registration_redemption_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_signup_intents" ADD COLUMN "registration_link_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_events" ADD CONSTRAINT "commercial_registration_link_events_registration_link_id_commercial_registration_links_id_fk" FOREIGN KEY ("registration_link_id") REFERENCES "public"."commercial_registration_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_registration_link_id_commercial_registration_links_id_fk" FOREIGN KEY ("registration_link_id") REFERENCES "public"."commercial_registration_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_signup_intent_id_customer_signup_intents_id_fk" FOREIGN KEY ("signup_intent_id") REFERENCES "public"."customer_signup_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_verified_user_id_users_id_fk" FOREIGN KEY ("verified_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_location_org_fk" FOREIGN KEY ("first_location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_registration_link_events_link_time_idx" ON "commercial_registration_link_events" USING btree ("registration_link_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_events_created_unique" ON "commercial_registration_link_events" USING btree ("registration_link_id") WHERE "commercial_registration_link_events"."action" = 'created';--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_events_disabled_unique" ON "commercial_registration_link_events" USING btree ("registration_link_id") WHERE "commercial_registration_link_events"."action" = 'disabled';--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_redemptions_intent_unique" ON "commercial_registration_link_redemptions" USING btree ("signup_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_redemptions_user_link_unique" ON "commercial_registration_link_redemptions" USING btree ("registration_link_id","verified_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_link_redemptions_id_org_product_unique" ON "commercial_registration_link_redemptions" USING btree ("id","organization_id","product_id");--> statement-breakpoint
CREATE INDEX "commercial_registration_link_redemptions_link_time_idx" ON "commercial_registration_link_redemptions" USING btree ("registration_link_id","redeemed_at");--> statement-breakpoint
CREATE INDEX "commercial_registration_link_redemptions_org_idx" ON "commercial_registration_link_redemptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_registration_links_token_hash_unique" ON "commercial_registration_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "commercial_registration_links_status_idx" ON "commercial_registration_links" USING btree ("created_at","expires_at","disabled_at");--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD CONSTRAINT "commercial_product_organization_authorizations_registration_redemption_id_commercial_registration_link_redemptions_id_fk" FOREIGN KEY ("registration_redemption_id") REFERENCES "public"."commercial_registration_link_redemptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD CONSTRAINT "commercial_product_org_authorizations_redemption_org_product_fk" FOREIGN KEY ("registration_redemption_id","organization_id","product_id") REFERENCES "public"."commercial_registration_link_redemptions"("id","organization_id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_signup_intents" ADD CONSTRAINT "customer_signup_intents_registration_link_id_commercial_registration_links_id_fk" FOREIGN KEY ("registration_link_id") REFERENCES "public"."commercial_registration_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_product_org_authorizations_redemption_unique" ON "commercial_product_organization_authorizations" USING btree ("registration_redemption_id") WHERE "commercial_product_organization_authorizations"."registration_redemption_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_signup_intents_id_registration_link_unique" ON "customer_signup_intents" USING btree ("id","registration_link_id");--> statement-breakpoint
ALTER TABLE "commercial_registration_link_redemptions" ADD CONSTRAINT "commercial_registration_link_redemptions_intent_link_fk" FOREIGN KEY ("signup_intent_id","registration_link_id") REFERENCES "public"."customer_signup_intents"("id","registration_link_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_product_organization_authorizations" ADD CONSTRAINT "commercial_product_org_authorizations_source_valid" CHECK (("commercial_product_organization_authorizations"."grant_source" = 'operator' AND "commercial_product_organization_authorizations"."granted_by_operator" IS NOT NULL AND length(btrim("commercial_product_organization_authorizations"."granted_by_operator")) > 0 AND "commercial_product_organization_authorizations"."registration_redemption_id" IS NULL) OR ("commercial_product_organization_authorizations"."grant_source" = 'registration_link' AND "commercial_product_organization_authorizations"."granted_by_operator" IS NULL AND "commercial_product_organization_authorizations"."registration_redemption_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "customer_signup_intents" ADD CONSTRAINT "customer_signup_intents_invite_registration_exclusive" CHECK ("customer_signup_intents"."invite_token_hash" IS NULL OR "customer_signup_intents"."registration_link_id" IS NULL);
--> statement-breakpoint
CREATE FUNCTION "reject_registration_link_history_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'registration link history is append-only';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_link_events_append_only" BEFORE UPDATE OR DELETE ON "commercial_registration_link_events" FOR EACH ROW EXECUTE FUNCTION "reject_registration_link_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_link_events_no_truncate" BEFORE TRUNCATE ON "commercial_registration_link_events" FOR EACH STATEMENT EXECUTE FUNCTION "reject_registration_link_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_link_redemptions_append_only" BEFORE UPDATE OR DELETE ON "commercial_registration_link_redemptions" FOR EACH ROW EXECUTE FUNCTION "reject_registration_link_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_link_redemptions_no_truncate" BEFORE TRUNCATE ON "commercial_registration_link_redemptions" FOR EACH STATEMENT EXECUTE FUNCTION "reject_registration_link_history_mutation"();
--> statement-breakpoint
CREATE FUNCTION "protect_registration_link_policy"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."id" IS DISTINCT FROM NEW."id" OR OLD."token_hash" IS DISTINCT FROM NEW."token_hash" OR OLD."policy_key" IS DISTINCT FROM NEW."policy_key" OR
	   OLD."policy_version" IS DISTINCT FROM NEW."policy_version" OR OLD."policy_snapshot" IS DISTINCT FROM NEW."policy_snapshot" OR
	   OLD."created_by_operator" IS DISTINCT FROM NEW."created_by_operator" OR OLD."creation_reason" IS DISTINCT FROM NEW."creation_reason" OR
	   OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at" OR
	   OLD."max_redemptions" IS DISTINCT FROM NEW."max_redemptions" OR OLD."disabled_at" IS NOT NULL OR
	   NEW."disabled_at" IS NULL OR NEW."disabled_by_operator" IS NULL OR NEW."disable_reason" IS NULL THEN
		RAISE EXCEPTION 'registration link policy is immutable; only first-time disable is allowed';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_links_policy_immutable" BEFORE UPDATE ON "commercial_registration_links" FOR EACH ROW EXECUTE FUNCTION "protect_registration_link_policy"();
--> statement-breakpoint
CREATE FUNCTION "reject_registration_link_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'registration link records are retained for audit';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_links_no_delete" BEFORE DELETE ON "commercial_registration_links" FOR EACH ROW EXECUTE FUNCTION "reject_registration_link_delete"();
--> statement-breakpoint
CREATE TRIGGER "commercial_registration_links_no_truncate" BEFORE TRUNCATE ON "commercial_registration_links" FOR EACH STATEMENT EXECUTE FUNCTION "reject_registration_link_delete"();
