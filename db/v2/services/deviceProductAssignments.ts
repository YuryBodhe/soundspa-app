import { sql, type SQL } from "drizzle-orm";
import { v2Db } from "../client";

/**
 * Idempotently associates currently activated Devices with Basic when the
 * Location has a current runtime-effective Basic entitlement. It deliberately
 * does not backfill Spaquatoria, mutate any entitlement, or revive a previously
 * revoked assignment.
 */
export const BACKFILL_ACTIVATED_BASIC_DEVICE_ASSIGNMENTS_SQL = sql`
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
  ON CONFLICT DO NOTHING
`;

export const BASIC_TRIAL_DEVICE_ASSIGNMENT_BACKFILL_QUOTA_CHECK_SQL = sql`
  WITH server_time AS MATERIALIZED (SELECT statement_timestamp() AS now)
  SELECT l.id AS location_id, count(DISTINCT d.id)::int AS activated_device_count
  FROM locations l
  JOIN organizations o ON o.id = l.organization_id
  JOIN organization_core_trial_locations slot ON slot.location_id = l.id AND slot.organization_id = l.organization_id
  JOIN organization_core_trials trial ON trial.id = slot.organization_trial_id
    AND trial.organization_id = slot.organization_id AND trial.status = 'active'
  JOIN commercial_products p ON p.id = trial.product_id AND p.code = 'soundspa' AND p.is_active = true
  JOIN devices d ON d.location_id = l.id AND d.status = 'active' AND d.credential_hash IS NOT NULL AND d.revoked_at IS NULL
  CROSS JOIN server_time
  WHERE l.archived_at IS NULL AND o.archived_at IS NULL
    AND trial.starts_at <= server_time.now AND trial.ends_at > server_time.now
    AND NOT EXISTS (
      SELECT 1 FROM location_subscriptions s
      WHERE s.location_id = l.id AND s.product_id = p.id
        AND s.invalidated_by_reset_id IS NULL
        AND s.status IN ('active', 'canceled')
        AND s.starts_at <= server_time.now
        AND (s.current_period_ends_at IS NULL OR s.current_period_ends_at > server_time.now)
    )
  GROUP BY l.id
  HAVING count(DISTINCT d.id) > 5
  LIMIT 1
`;

type BackfillExecutor = { execute(query: SQL): Promise<{ rowCount: number | null; rows: unknown[] }> };

/** Execute inside a caller-owned transaction so integration tests can roll back fixtures. */
export async function backfillActivatedBasicDeviceAssignmentsInTransaction(tx: BackfillExecutor) {
  const overQuota = await tx.execute(BASIC_TRIAL_DEVICE_ASSIGNMENT_BACKFILL_QUOTA_CHECK_SQL);
  if (overQuota.rows.length > 0) {
    throw new Error("Basic Trial Device assignment backfill requires review: an eligible Location has more than five activated Devices.");
  }
  const result = await tx.execute(BACKFILL_ACTIVATED_BASIC_DEVICE_ASSIGNMENTS_SQL);
  return result.rowCount ?? result.rows.length;
}

export async function backfillActivatedBasicDeviceAssignments() {
  return v2Db.transaction((tx) => backfillActivatedBasicDeviceAssignmentsInTransaction(tx));
}
