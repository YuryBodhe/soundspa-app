CREATE TABLE "commercial_payment_route_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"action" text NOT NULL,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_payment_route_events_action_valid" CHECK ("commercial_payment_route_events"."action" IN ('created', 'enabled', 'disabled', 'priority_changed')),
	CONSTRAINT "commercial_payment_route_events_operator_nonempty" CHECK (length(btrim("commercial_payment_route_events"."operator")) > 0),
	CONSTRAINT "commercial_payment_route_events_reason_nonempty" CHECK (length(btrim("commercial_payment_route_events"."reason")) BETWEEN 12 AND 500),
	CONSTRAINT "commercial_payment_route_events_state_shape" CHECK (jsonb_typeof("commercial_payment_route_events"."after_state") = 'object' AND ("commercial_payment_route_events"."before_state" IS NULL OR jsonb_typeof("commercial_payment_route_events"."before_state") = 'object'))
);
--> statement-breakpoint
ALTER TABLE "commercial_payment_route_events" ADD CONSTRAINT "commercial_payment_route_events_route_id_commercial_payment_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."commercial_payment_routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_payment_route_events_route_time_idx" ON "commercial_payment_route_events" USING btree ("route_id","created_at");--> statement-breakpoint
CREATE FUNCTION "reject_commercial_payment_route_event_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'commercial payment route audit events are append-only';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_payment_route_events_append_only"
BEFORE UPDATE OR DELETE ON "commercial_payment_route_events"
FOR EACH ROW EXECUTE FUNCTION "reject_commercial_payment_route_event_mutation"();
--> statement-breakpoint
CREATE TRIGGER "commercial_payment_route_events_no_truncate"
BEFORE TRUNCATE ON "commercial_payment_route_events"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_commercial_payment_route_event_mutation"();
--> statement-breakpoint
CREATE FUNCTION "reject_commercial_payment_route_identity_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."product_id" IS DISTINCT FROM NEW."product_id" OR
	   OLD."market_code" IS DISTINCT FROM NEW."market_code" OR
	   OLD."provider_code" IS DISTINCT FROM NEW."provider_code" OR
	   OLD."external_reference" IS DISTINCT FROM NEW."external_reference" THEN
		RAISE EXCEPTION 'commercial payment route identity is immutable';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "commercial_payment_routes_identity_immutable"
BEFORE UPDATE OF "product_id", "market_code", "provider_code", "external_reference" ON "commercial_payment_routes"
FOR EACH ROW EXECUTE FUNCTION "reject_commercial_payment_route_identity_change"();
