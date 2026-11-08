CREATE TABLE "organization_core_trial_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_trial_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"slot_number" integer NOT NULL,
	"source" text NOT NULL,
	"legacy_trial_id" uuid,
	"legacy_origin" text,
	"allocated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_core_trial_locations_legacy_trial_id_unique" UNIQUE("legacy_trial_id"),
	CONSTRAINT "organization_core_trial_locations_slot_range" CHECK ("organization_core_trial_locations"."slot_number" BETWEEN 1 AND 5),
	CONSTRAINT "organization_core_trial_locations_source_valid" CHECK ("organization_core_trial_locations"."source" IN ('legacy_trial', 'active_window_backfill', 'first_location_creation', 'additional_location_creation')),
	CONSTRAINT "organization_core_trial_locations_legacy_provenance_shape" CHECK (("organization_core_trial_locations"."source" = 'legacy_trial' AND "organization_core_trial_locations"."legacy_trial_id" IS NOT NULL AND "organization_core_trial_locations"."legacy_origin" IS NOT NULL) OR ("organization_core_trial_locations"."source" <> 'legacy_trial' AND "organization_core_trial_locations"."legacy_trial_id" IS NULL AND "organization_core_trial_locations"."legacy_origin" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "organization_core_trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" "commercial_trial_status" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_core_trials_window" CHECK ("organization_core_trials"."ends_at" > "organization_core_trials"."starts_at"),
	CONSTRAINT "organization_core_trials_origin_valid" CHECK ("organization_core_trials"."origin" IN ('legacy_backfill', 'first_location_creation'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_core_trials_id_organization_unique" ON "organization_core_trials" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "organization_core_trial_locations" ADD CONSTRAINT "organization_core_trial_locations_legacy_trial_id_location_core_trials_id_fk" FOREIGN KEY ("legacy_trial_id") REFERENCES "public"."location_core_trials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_core_trial_locations" ADD CONSTRAINT "organization_core_trial_locations_trial_org_fk" FOREIGN KEY ("organization_trial_id","organization_id") REFERENCES "public"."organization_core_trials"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_core_trial_locations" ADD CONSTRAINT "organization_core_trial_locations_location_org_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_core_trials" ADD CONSTRAINT "organization_core_trials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_core_trials" ADD CONSTRAINT "organization_core_trials_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_core_trial_locations_trial_location_unique" ON "organization_core_trial_locations" USING btree ("organization_trial_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_core_trial_locations_trial_slot_unique" ON "organization_core_trial_locations" USING btree ("organization_trial_id","slot_number");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_core_trial_locations_location_unique" ON "organization_core_trial_locations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "organization_core_trial_locations_org_slot_idx" ON "organization_core_trial_locations" USING btree ("organization_id","slot_number");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_core_trials_organization_unique" ON "organization_core_trials" USING btree ("organization_id");--> statement-breakpoint
-- Freeze legacy trial and Location membership while validating and copying the backfill snapshot.
-- The migrator runs this migration transactionally, so normal onboarding writes resume at commit.
LOCK TABLE location_core_trials, locations IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT l.organization_id
		FROM location_core_trials t
		JOIN locations l ON l.id = t.location_id
		JOIN commercial_products p ON p.id = t.product_id
		WHERE p.code = 'soundspa'
		GROUP BY l.organization_id
		HAVING count(DISTINCT (t.starts_at, t.ends_at)) > 1 OR count(DISTINCT t.status) > 1
	) THEN
		RAISE EXCEPTION 'Organization Basic trial backfill found conflicting legacy windows or statuses; manual review required'
			USING ERRCODE = '23514', CONSTRAINT = 'organization_core_trials_legacy_window_conflict';
	END IF;

	IF EXISTS (
		SELECT l.organization_id, t.location_id
		FROM location_core_trials t
		JOIN locations l ON l.id = t.location_id
		JOIN commercial_products p ON p.id = t.product_id
		WHERE p.code = 'soundspa'
		GROUP BY l.organization_id, t.location_id
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Organization Basic trial backfill found repeated legacy trials for a Location; manual review required'
			USING ERRCODE = '23514', CONSTRAINT = 'organization_core_trials_legacy_location_repeat';
	END IF;

	IF EXISTS (
		SELECT l.organization_id
		FROM location_core_trials t
		JOIN locations l ON l.id = t.location_id
		JOIN commercial_products p ON p.id = t.product_id
		WHERE p.code = 'soundspa'
		GROUP BY l.organization_id
		HAVING count(DISTINCT t.location_id) > 5
	) THEN
		RAISE EXCEPTION 'Organization Basic trial backfill exceeds the five cumulative Location slots; manual review required'
			USING ERRCODE = '23514', CONSTRAINT = 'organization_core_trials_legacy_location_cap';
	END IF;
END $$;
--> statement-breakpoint
WITH legacy AS (
	SELECT l.organization_id, t.product_id, t.status, t.starts_at, t.ends_at
	FROM location_core_trials t
	JOIN locations l ON l.id = t.location_id
	JOIN commercial_products p ON p.id = t.product_id
	WHERE p.code = 'soundspa'
	GROUP BY l.organization_id, t.product_id, t.status, t.starts_at, t.ends_at
), inserted AS (
	INSERT INTO organization_core_trials (organization_id, product_id, status, starts_at, ends_at, origin)
	SELECT organization_id, product_id, status, starts_at, ends_at, 'legacy_backfill'
	FROM legacy
	RETURNING id, organization_id
)
INSERT INTO organization_core_trial_locations (
	organization_trial_id, organization_id, location_id, slot_number, source,
	legacy_trial_id, legacy_origin, allocated_at
)
SELECT i.id, i.organization_id, l.id,
	row_number() OVER (PARTITION BY i.organization_id ORDER BY l.created_at, l.id)::integer,
	'legacy_trial', t.id,
	CASE
		WHEN t.registration_link_grant_id IS NOT NULL THEN 'registration_link'
		WHEN EXISTS (SELECT 1 FROM commercial_partner_invite_claims c WHERE c.location_id = l.id) THEN 'partner_invite_possible'
		WHEN abs(extract(epoch FROM (t.created_at - l.created_at))) <= 1 THEN 'onboarding_inferred'
		ELSE 'unknown'
	END,
	GREATEST(t.starts_at, l.created_at)
FROM inserted i
JOIN locations l ON l.organization_id = i.organization_id
JOIN location_core_trials t ON t.location_id = l.id AND t.product_id = (
	SELECT p.id FROM commercial_products p WHERE p.code = 'soundspa' LIMIT 1
)
ORDER BY i.organization_id, l.created_at, l.id;
--> statement-breakpoint
WITH active_trials AS (
	SELECT t.id AS trial_id, t.organization_id, t.starts_at
	FROM organization_core_trials t
	WHERE t.status = 'active' AND t.starts_at <= CURRENT_TIMESTAMP AND t.ends_at > CURRENT_TIMESTAMP
), used_slots AS (
	SELECT a.organization_trial_id AS trial_id, count(*)::integer AS used
	FROM organization_core_trial_locations a
	GROUP BY a.organization_trial_id
), candidates AS (
	SELECT t.trial_id, t.organization_id, t.starts_at, l.id AS location_id, l.created_at,
		COALESCE(u.used, 0) + row_number() OVER (PARTITION BY t.trial_id ORDER BY l.created_at, l.id)::integer AS slot_number
	FROM active_trials t
	JOIN locations l ON l.organization_id = t.organization_id AND l.archived_at IS NULL
	LEFT JOIN used_slots u ON u.trial_id = t.trial_id
	WHERE NOT EXISTS (
		SELECT 1 FROM organization_core_trial_locations a
		WHERE a.organization_trial_id = t.trial_id AND a.location_id = l.id
	)
)
INSERT INTO organization_core_trial_locations (
	organization_trial_id, organization_id, location_id, slot_number, source, allocated_at
)
SELECT c.trial_id, c.organization_id, c.location_id, c.slot_number, 'active_window_backfill', GREATEST(c.starts_at, c.created_at)
FROM candidates c
WHERE c.slot_number <= 5
ORDER BY c.organization_id, c.slot_number;
--> statement-breakpoint
CREATE FUNCTION "reject_organization_core_trial_location_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Organization trial Location allocations are immutable and slots cannot be released';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "organization_core_trial_locations_append_only"
BEFORE UPDATE OR DELETE ON "organization_core_trial_locations"
FOR EACH ROW EXECUTE FUNCTION "reject_organization_core_trial_location_mutation"();
--> statement-breakpoint
CREATE TRIGGER "organization_core_trial_locations_no_truncate"
BEFORE TRUNCATE ON "organization_core_trial_locations"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_organization_core_trial_location_mutation"();
--> statement-breakpoint
CREATE FUNCTION "protect_organization_core_trial_window"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.organization_id IS DISTINCT FROM NEW.organization_id OR
	   OLD.product_id IS DISTINCT FROM NEW.product_id OR
	   OLD.starts_at IS DISTINCT FROM NEW.starts_at OR
	   OLD.ends_at IS DISTINCT FROM NEW.ends_at OR
	   OLD.origin IS DISTINCT FROM NEW.origin OR
	   OLD.created_at IS DISTINCT FROM NEW.created_at THEN
		RAISE EXCEPTION 'Organization Basic trial identity and dates are immutable';
	END IF;
	IF OLD.status = 'expired' AND NEW.status <> 'expired' THEN
		RAISE EXCEPTION 'Expired Organization Basic trials cannot be reactivated';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "organization_core_trials_window_immutable"
BEFORE UPDATE ON "organization_core_trials"
FOR EACH ROW EXECUTE FUNCTION "protect_organization_core_trial_window"();
--> statement-breakpoint
CREATE FUNCTION "reject_organization_core_trial_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Organization Basic trial history is retained';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "organization_core_trials_no_delete"
BEFORE DELETE OR TRUNCATE ON "organization_core_trials"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_organization_core_trial_delete"();
