CREATE TABLE "device_product_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	CONSTRAINT "device_product_assignments_source_valid" CHECK ("device_product_assignments"."source" IN ('legacy_basic_backfill', 'device_activation', 'operator')),
	CONSTRAINT "device_product_assignments_revocation_shape" CHECK (
    ("device_product_assignments"."revoked_at" IS NULL AND "device_product_assignments"."revoked_by" IS NULL AND "device_product_assignments"."revoke_reason" IS NULL) OR
    ("device_product_assignments"."revoked_at" IS NOT NULL AND "device_product_assignments"."revoked_by" IS NOT NULL AND length(btrim("device_product_assignments"."revoked_by")) BETWEEN 1 AND 160 AND "device_product_assignments"."revoke_reason" IS NOT NULL AND length(btrim("device_product_assignments"."revoke_reason")) BETWEEN 1 AND 500)
  )
);
--> statement-breakpoint
ALTER TABLE "device_product_assignments" ADD CONSTRAINT "device_product_assignments_device_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_product_assignments" ADD CONSTRAINT "device_product_assignments_product_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_product_assignments_active_unique" ON "device_product_assignments" USING btree ("device_id","product_id") WHERE "device_product_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "device_product_assignments_device_idx" ON "device_product_assignments" USING btree ("device_id","revoked_at");--> statement-breakpoint
CREATE INDEX "device_product_assignments_product_idx" ON "device_product_assignments" USING btree ("product_id","revoked_at");--> statement-breakpoint
-- Stop rather than silently backfill beyond the approved Basic Trial cap.
DO $$
DECLARE v_now timestamptz := statement_timestamp();
BEGIN
  IF EXISTS (
    SELECT 1
    FROM locations l
    JOIN organizations o ON o.id = l.organization_id
    JOIN organization_core_trial_locations slot ON slot.location_id = l.id AND slot.organization_id = l.organization_id
    JOIN organization_core_trials trial ON trial.id = slot.organization_trial_id
      AND trial.organization_id = slot.organization_id AND trial.status = 'active'
    JOIN commercial_products p ON p.id = trial.product_id AND p.code = 'soundspa' AND p.is_active = true
    JOIN devices d ON d.location_id = l.id AND d.status = 'active' AND d.credential_hash IS NOT NULL AND d.revoked_at IS NULL
    WHERE l.archived_at IS NULL AND o.archived_at IS NULL
      AND trial.starts_at <= v_now AND trial.ends_at > v_now
      AND NOT EXISTS (
        SELECT 1 FROM location_subscriptions s
        WHERE s.location_id = l.id AND s.product_id = p.id
          AND s.invalidated_by_reset_id IS NULL
          AND s.status IN ('active', 'canceled')
          AND s.starts_at <= v_now
          AND (s.current_period_ends_at IS NULL OR s.current_period_ends_at > v_now)
      )
    GROUP BY l.id
    HAVING count(DISTINCT d.id) > 5
  ) THEN
    RAISE EXCEPTION 'Device Product assignment backfill blocked: a Basic Trial Location exceeds the five activated Device quota';
  END IF;
END $$;--> statement-breakpoint
-- Backfill only currently activated Devices with a runtime-effective Basic entitlement.
-- This is deliberately inert until a later application phase consumes assignments.
WITH server_time AS MATERIALIZED (SELECT statement_timestamp() AS now)
INSERT INTO device_product_assignments (device_id, product_id, source, assigned_at)
SELECT DISTINCT d.id, p.id, 'legacy_basic_backfill', server_time.now
FROM devices d
JOIN locations l ON l.id = d.location_id
JOIN organizations o ON o.id = l.organization_id
JOIN commercial_products p ON p.code = 'soundspa' AND p.is_active = true
CROSS JOIN server_time
WHERE d.status = 'active'
  AND d.credential_hash IS NOT NULL
  AND d.revoked_at IS NULL
  AND l.archived_at IS NULL
  AND o.archived_at IS NULL
  AND (
    EXISTS (
      SELECT 1 FROM location_subscriptions s
      WHERE s.location_id = l.id AND s.product_id = p.id
        AND s.invalidated_by_reset_id IS NULL
        AND s.status IN ('active', 'canceled')
        AND s.starts_at <= server_time.now
        AND (s.current_period_ends_at IS NULL OR s.current_period_ends_at > server_time.now)
    )
    OR EXISTS (
      SELECT 1
      FROM organization_core_trial_locations slot
      JOIN organization_core_trials trial ON trial.id = slot.organization_trial_id
        AND trial.organization_id = slot.organization_id
      WHERE slot.location_id = l.id
        AND trial.organization_id = l.organization_id
        AND trial.product_id = p.id
        AND trial.status = 'active'
        AND trial.starts_at <= server_time.now
        AND trial.ends_at > server_time.now
    )
    OR EXISTS (
      SELECT 1 FROM commercial_partner_benefits benefit
      JOIN commercial_partners partner ON partner.id = benefit.partner_id AND partner.is_active = true
      WHERE benefit.location_id = l.id AND benefit.product_id = p.id
        AND benefit.starts_at <= server_time.now
        AND (benefit.ends_at IS NULL OR benefit.ends_at > server_time.now)
    )
    OR EXISTS (
      SELECT 1 FROM commercial_promotional_access.location_product_promotional_access promotion
      WHERE promotion.location_id = l.id AND promotion.product_id = p.id
        AND promotion.status = 'granted'
        AND promotion.starts_at <= server_time.now
        AND promotion.ends_at > server_time.now
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM device_product_assignments prior
    WHERE prior.device_id = d.id AND prior.product_id = p.id
  )
ON CONFLICT DO NOTHING;
