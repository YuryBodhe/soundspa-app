CREATE SCHEMA "commercial_promotional_access";
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_partner_invite_claims_id_location_unique" ON "public"."commercial_partner_invite_claims" USING btree ("id","location_id");
--> statement-breakpoint
CREATE TABLE "commercial_promotional_access"."location_product_promotional_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"registration_link_grant_id" uuid,
	"partner_invite_claim_id" uuid,
	"duration_unit" text NOT NULL,
	"duration_value" integer NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'granted' NOT NULL,
	"granted_by_operator" text,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"operator_request_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_operator" text,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_product_promotional_access_source_shape" CHECK (
    ("commercial_promotional_access"."location_product_promotional_access"."source" = 'operator' AND "commercial_promotional_access"."location_product_promotional_access"."registration_link_grant_id" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."partner_invite_claim_id" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."granted_by_operator" IS NOT NULL AND length(btrim("commercial_promotional_access"."location_product_promotional_access"."granted_by_operator")) > 0 AND "commercial_promotional_access"."location_product_promotional_access"."operator_request_id" IS NOT NULL AND "commercial_promotional_access"."location_product_promotional_access"."reason_code" IN ('testing','partner_offer','compensation','other')) OR
    ("commercial_promotional_access"."location_product_promotional_access"."source" = 'registration_link' AND "commercial_promotional_access"."location_product_promotional_access"."registration_link_grant_id" IS NOT NULL AND "commercial_promotional_access"."location_product_promotional_access"."partner_invite_claim_id" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."granted_by_operator" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."operator_request_id" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."reason_code" = 'source_grant') OR
    ("commercial_promotional_access"."location_product_promotional_access"."source" = 'partner_invite' AND "commercial_promotional_access"."location_product_promotional_access"."registration_link_grant_id" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."partner_invite_claim_id" IS NOT NULL AND "commercial_promotional_access"."location_product_promotional_access"."granted_by_operator" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."operator_request_id" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."reason_code" = 'source_grant')),
	CONSTRAINT "location_product_promotional_access_duration_shape" CHECK (
    ("commercial_promotional_access"."location_product_promotional_access"."duration_unit" = 'calendar_months' AND "commercial_promotional_access"."location_product_promotional_access"."duration_value" BETWEEN 1 AND 12) OR
    ("commercial_promotional_access"."location_product_promotional_access"."duration_unit" = 'days' AND "commercial_promotional_access"."location_product_promotional_access"."duration_value" > 0)),
	CONSTRAINT "location_product_promotional_access_window" CHECK ("commercial_promotional_access"."location_product_promotional_access"."ends_at" > "commercial_promotional_access"."location_product_promotional_access"."starts_at"),
	CONSTRAINT "location_product_promotional_access_reason_nonempty" CHECK (length(btrim("commercial_promotional_access"."location_product_promotional_access"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "location_product_promotional_access_status_shape" CHECK (
    ("commercial_promotional_access"."location_product_promotional_access"."status" = 'granted' AND "commercial_promotional_access"."location_product_promotional_access"."revoked_at" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."revoked_by_operator" IS NULL AND "commercial_promotional_access"."location_product_promotional_access"."revoke_reason" IS NULL) OR
    ("commercial_promotional_access"."location_product_promotional_access"."status" = 'revoked' AND "commercial_promotional_access"."location_product_promotional_access"."revoked_at" IS NOT NULL AND "commercial_promotional_access"."location_product_promotional_access"."revoked_by_operator" IS NOT NULL AND length(btrim("commercial_promotional_access"."location_product_promotional_access"."revoked_by_operator")) > 0 AND "commercial_promotional_access"."location_product_promotional_access"."revoke_reason" IS NOT NULL AND length(btrim("commercial_promotional_access"."location_product_promotional_access"."revoke_reason")) BETWEEN 1 AND 500 AND "commercial_promotional_access"."location_product_promotional_access"."revoked_at" >= "commercial_promotional_access"."location_product_promotional_access"."granted_at"))
);
--> statement-breakpoint
CREATE TABLE "commercial_promotional_access"."location_product_promotional_access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotional_access_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"operator" text,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "location_product_promotional_access_events_action_valid" CHECK ("commercial_promotional_access"."location_product_promotional_access_events"."action" IN ('granted','revoked')),
	CONSTRAINT "location_product_promotional_access_events_actor_shape" CHECK (("commercial_promotional_access"."location_product_promotional_access_events"."actor_type" = 'operator' AND "commercial_promotional_access"."location_product_promotional_access_events"."operator" IS NOT NULL AND length(btrim("commercial_promotional_access"."location_product_promotional_access_events"."operator")) > 0) OR ("commercial_promotional_access"."location_product_promotional_access_events"."actor_type" = 'system' AND "commercial_promotional_access"."location_product_promotional_access_events"."operator" IS NULL)),
	CONSTRAINT "location_product_promotional_access_events_reason_nonempty" CHECK (length(btrim("commercial_promotional_access"."location_product_promotional_access_events"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "commercial_promotional_access"."location_product_promotional_access" ADD CONSTRAINT "location_product_promotional_access_location_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_promotional_access"."location_product_promotional_access" ADD CONSTRAINT "location_product_promotional_access_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_promotional_access"."location_product_promotional_access" ADD CONSTRAINT "location_product_promotional_access_registration_grant_fk" FOREIGN KEY ("registration_link_grant_id","product_id","location_id") REFERENCES "public"."commercial_registration_link_grants"("id","product_id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_promotional_access"."location_product_promotional_access" ADD CONSTRAINT "location_product_promotional_access_partner_claim_fk" FOREIGN KEY ("partner_invite_claim_id","location_id") REFERENCES "public"."commercial_partner_invite_claims"("id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_promotional_access"."location_product_promotional_access_events" ADD CONSTRAINT "location_product_promotional_access_events_promotional_access_id_location_product_promotional_access_id_fk" FOREIGN KEY ("promotional_access_id") REFERENCES "commercial_promotional_access"."location_product_promotional_access"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "location_product_promotional_access_registration_grant_unique" ON "commercial_promotional_access"."location_product_promotional_access" USING btree ("registration_link_grant_id") WHERE "commercial_promotional_access"."location_product_promotional_access"."registration_link_grant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "location_product_promotional_access_partner_claim_product_unique" ON "commercial_promotional_access"."location_product_promotional_access" USING btree ("partner_invite_claim_id","product_id") WHERE "commercial_promotional_access"."location_product_promotional_access"."partner_invite_claim_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "location_product_promotional_access_operator_request_unique" ON "commercial_promotional_access"."location_product_promotional_access" USING btree ("operator_request_id") WHERE "commercial_promotional_access"."location_product_promotional_access"."operator_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "location_product_promotional_access_effective_idx" ON "commercial_promotional_access"."location_product_promotional_access" USING btree ("location_id","product_id","status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "location_product_promotional_access_history_idx" ON "commercial_promotional_access"."location_product_promotional_access" USING btree ("location_id","product_id","granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "location_product_promotional_access_events_action_unique" ON "commercial_promotional_access"."location_product_promotional_access_events" USING btree ("promotional_access_id","action");--> statement-breakpoint
CREATE INDEX "location_product_promotional_access_events_time_idx" ON "commercial_promotional_access"."location_product_promotional_access_events" USING btree ("promotional_access_id","occurred_at");--> statement-breakpoint
CREATE FUNCTION "commercial_promotional_access"."validate_location_product_promotional_access_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	product_code text;
	source_access_type text;
	source_duration integer;
BEGIN
	SELECT code INTO product_code FROM public.commercial_products WHERE id = NEW.product_id;
	IF product_code = 'spaquatoria' THEN
		RAISE EXCEPTION 'Spaquatoria Gift must remain a Partner Benefit';
	END IF;
	IF NEW.source = 'registration_link' THEN
		SELECT access_type, duration_months INTO source_access_type, source_duration
		FROM public.commercial_registration_link_grants
		WHERE id = NEW.registration_link_grant_id AND product_id = NEW.product_id AND location_id = NEW.location_id;
		IF source_access_type IS DISTINCT FROM 'trial' OR product_code IS DISTINCT FROM 'soundspa' OR
		   NEW.duration_unit IS DISTINCT FROM 'calendar_months' OR NEW.duration_value IS DISTINCT FROM source_duration THEN
			RAISE EXCEPTION 'Registration Link promotional provenance is invalid';
		END IF;
	ELSIF NEW.source = 'partner_invite' THEN
		SELECT g.grant_type, g.duration_days INTO source_access_type, source_duration
		FROM public.commercial_partner_invite_claims c
		JOIN public.commercial_partner_invites i ON i.id = c.invite_id
		JOIN public.commercial_offer_grants g ON g.offer_id = i.offer_id
		WHERE c.id = NEW.partner_invite_claim_id AND c.location_id = NEW.location_id AND g.product_id = NEW.product_id;
		IF source_access_type IS DISTINCT FROM 'trial' OR product_code IS DISTINCT FROM 'soundspa' OR
		   NEW.duration_unit IS DISTINCT FROM 'days' OR NEW.duration_value IS DISTINCT FROM source_duration THEN
			RAISE EXCEPTION 'Partner Invite promotional provenance is invalid';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "location_product_promotional_access_source_valid"
BEFORE INSERT ON "commercial_promotional_access"."location_product_promotional_access"
FOR EACH ROW EXECUTE FUNCTION "commercial_promotional_access"."validate_location_product_promotional_access_source"();
--> statement-breakpoint
CREATE FUNCTION "commercial_promotional_access"."protect_location_product_promotional_access"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'Promotional Access grant history cannot be truncated';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Promotional Access grant history cannot be deleted';
	END IF;
	IF OLD.id IS DISTINCT FROM NEW.id OR OLD.location_id IS DISTINCT FROM NEW.location_id OR
	   OLD.product_id IS DISTINCT FROM NEW.product_id OR OLD.source IS DISTINCT FROM NEW.source OR
	   OLD.registration_link_grant_id IS DISTINCT FROM NEW.registration_link_grant_id OR
	   OLD.partner_invite_claim_id IS DISTINCT FROM NEW.partner_invite_claim_id OR
	   OLD.duration_unit IS DISTINCT FROM NEW.duration_unit OR OLD.duration_value IS DISTINCT FROM NEW.duration_value OR
	   OLD.granted_at IS DISTINCT FROM NEW.granted_at OR OLD.starts_at IS DISTINCT FROM NEW.starts_at OR
	   OLD.ends_at IS DISTINCT FROM NEW.ends_at OR OLD.granted_by_operator IS DISTINCT FROM NEW.granted_by_operator OR
	   OLD.reason_code IS DISTINCT FROM NEW.reason_code OR OLD.reason IS DISTINCT FROM NEW.reason OR
	   OLD.operator_request_id IS DISTINCT FROM NEW.operator_request_id OR OLD.created_at IS DISTINCT FROM NEW.created_at OR
	   OLD.status <> 'granted' OR NEW.status <> 'revoked' THEN
		RAISE EXCEPTION 'Promotional Access grants are immutable except for one-way revocation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "location_product_promotional_access_immutable"
BEFORE UPDATE OR DELETE ON "commercial_promotional_access"."location_product_promotional_access"
FOR EACH ROW EXECUTE FUNCTION "commercial_promotional_access"."protect_location_product_promotional_access"();
--> statement-breakpoint
CREATE TRIGGER "location_product_promotional_access_no_truncate"
BEFORE TRUNCATE ON "commercial_promotional_access"."location_product_promotional_access"
FOR EACH STATEMENT EXECUTE FUNCTION "commercial_promotional_access"."protect_location_product_promotional_access"();
--> statement-breakpoint
CREATE FUNCTION "commercial_promotional_access"."protect_location_product_promotional_access_events"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'Promotional Access audit history cannot be truncated';
	END IF;
	RAISE EXCEPTION 'Promotional Access audit history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "location_product_promotional_access_events_append_only"
BEFORE UPDATE OR DELETE ON "commercial_promotional_access"."location_product_promotional_access_events"
FOR EACH ROW EXECUTE FUNCTION "commercial_promotional_access"."protect_location_product_promotional_access_events"();
--> statement-breakpoint
CREATE TRIGGER "location_product_promotional_access_events_no_truncate"
BEFORE TRUNCATE ON "commercial_promotional_access"."location_product_promotional_access_events"
FOR EACH STATEMENT EXECUTE FUNCTION "commercial_promotional_access"."protect_location_product_promotional_access_events"();
