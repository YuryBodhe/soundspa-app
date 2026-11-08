import { and, eq, gt, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialPartnerBenefits,
  commercialPartners,
  commercialProducts,
  deviceProductAssignments,
  devices,
  locationProductPromotionalAccess,
  locationSubscriptions,
  locations,
  organizationCoreTrialLocations,
  organizationCoreTrials,
  organizations,
} from "../schema";
import { deviceProductAssignmentLimit, canAssignActivatedDevice } from "./deviceProductPolicy";

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
type DeviceProductTransaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

export class DeviceProductAssignmentError extends Error {
  constructor(readonly code: "location_unavailable" | "device_unavailable" | "basic_device_limit_reached") {
    super(code === "basic_device_limit_reached"
      ? "This Location has reached its active Basic Trial Device limit."
      : "Device assignment is unavailable.");
    this.name = "DeviceProductAssignmentError";
  }
}

/**
 * Called only while issuing a Device credential. Organization then Location
 * row locks serialize all activation paths and also coordinate with archive.
 */
export async function assignBasicDeviceProductOnActivationInTransaction(
  tx: DeviceProductTransaction,
  input: { locationId: string; deviceId: string },
): Promise<"assigned" | "existing" | "no_entitlement" | "historically_revoked"> {
  const [locationRef] = await tx.select({ organizationId: locations.organizationId })
    .from(locations).where(eq(locations.id, input.locationId)).limit(1);
  if (!locationRef) throw new DeviceProductAssignmentError("location_unavailable");

  const [organization] = await tx.select({ archivedAt: organizations.archivedAt })
    .from(organizations).where(eq(organizations.id, locationRef.organizationId)).for("update").limit(1);
  const [location] = await tx.select({ organizationId: locations.organizationId, archivedAt: locations.archivedAt })
    .from(locations).where(eq(locations.id, input.locationId)).for("update").limit(1);
  if (!organization || organization.archivedAt || !location || location.organizationId !== locationRef.organizationId || location.archivedAt) {
    throw new DeviceProductAssignmentError("location_unavailable");
  }

  const [device] = await tx.select({ status: devices.status, revokedAt: devices.revokedAt })
    .from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.locationId, input.locationId)))
    .for("update").limit(1);
  if (!device || device.status !== "active" || device.revokedAt) throw new DeviceProductAssignmentError("device_unavailable");

  const [product] = await tx.select({ id: commercialProducts.id })
    .from(commercialProducts).where(and(eq(commercialProducts.code, "soundspa"), eq(commercialProducts.isActive, true))).limit(1);
  if (!product) return "no_entitlement";

  const [activeAssignment] = await tx.select({ id: deviceProductAssignments.id })
    .from(deviceProductAssignments).where(and(
      eq(deviceProductAssignments.deviceId, input.deviceId),
      eq(deviceProductAssignments.productId, product.id),
      isNull(deviceProductAssignments.revokedAt),
    )).limit(1);
  if (activeAssignment) return "existing";

  // Never turn a historical explicit revocation into an automatic reassignment.
  const [revokedAssignment] = await tx.select({ id: deviceProductAssignments.id })
    .from(deviceProductAssignments).where(and(
      eq(deviceProductAssignments.deviceId, input.deviceId),
      eq(deviceProductAssignments.productId, product.id),
      sql`${deviceProductAssignments.revokedAt} IS NOT NULL`,
    )).limit(1);
  if (revokedAssignment) return "historically_revoked";

  const clockResult = await tx.execute(sql`SELECT statement_timestamp() AS now`);
  const clockValue = (clockResult.rows[0] as { now?: Date | string } | undefined)?.now;
  const now = clockValue instanceof Date ? clockValue : new Date(String(clockValue));
  if (!Number.isFinite(now.getTime())) throw new Error("Database server time was unavailable for Device assignment.");

  const [paid] = await tx.select({ id: locationSubscriptions.id }).from(locationSubscriptions)
    .where(and(
      eq(locationSubscriptions.locationId, input.locationId),
      eq(locationSubscriptions.productId, product.id),
      isNull(locationSubscriptions.invalidatedByResetId),
      inArray(locationSubscriptions.status, ["active", "canceled"]),
      lte(locationSubscriptions.startsAt, now),
      or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now)),
    )).limit(1);

  const [trial] = await tx.select({ id: organizationCoreTrials.id }).from(organizationCoreTrialLocations)
    .innerJoin(organizationCoreTrials, and(
      eq(organizationCoreTrials.id, organizationCoreTrialLocations.organizationTrialId),
      eq(organizationCoreTrials.organizationId, organizationCoreTrialLocations.organizationId),
    )).where(and(
      eq(organizationCoreTrialLocations.locationId, input.locationId),
      eq(organizationCoreTrialLocations.organizationId, location.organizationId),
      eq(organizationCoreTrials.productId, product.id),
      eq(organizationCoreTrials.status, "active"),
      lte(organizationCoreTrials.startsAt, now),
      gt(organizationCoreTrials.endsAt, now),
    )).limit(1);

  const [benefit] = await tx.select({ id: commercialPartnerBenefits.id }).from(commercialPartnerBenefits)
    .innerJoin(commercialPartners, and(
      eq(commercialPartners.id, commercialPartnerBenefits.partnerId),
      eq(commercialPartners.isActive, true),
    )).where(and(
      eq(commercialPartnerBenefits.locationId, input.locationId),
      eq(commercialPartnerBenefits.productId, product.id),
      lte(commercialPartnerBenefits.startsAt, now),
      or(isNull(commercialPartnerBenefits.endsAt), gt(commercialPartnerBenefits.endsAt, now)),
    )).limit(1);

  const [promotion] = await tx.select({ id: locationProductPromotionalAccess.id })
    .from(locationProductPromotionalAccess).where(and(
      eq(locationProductPromotionalAccess.locationId, input.locationId),
      eq(locationProductPromotionalAccess.productId, product.id),
      eq(locationProductPromotionalAccess.status, "granted"),
      lte(locationProductPromotionalAccess.startsAt, now),
      gt(locationProductPromotionalAccess.endsAt, now),
    )).limit(1);

  const bases: Array<"basic_trial" | "basic_paid" | "other"> = [];
  if (trial) bases.push("basic_trial");
  if (paid) bases.push("basic_paid");
  if (benefit || promotion) bases.push("other");
  if (!bases.length) return "no_entitlement";

  const limit = deviceProductAssignmentLimit("soundspa", bases);
  // Migration 0036 backfilled existing activated Devices, but an older app
  // could still have activated Devices between that migration and this runtime
  // cutover. Count those credentialed identities too, while excluding the
  // current-browser candidate (which already has a credential before commit).
  const countResult = await tx.execute(sql`
    SELECT count(DISTINCT d.id)::int AS count
    FROM devices d
    WHERE d.location_id = ${input.locationId}::uuid
      AND d.status = 'active' AND d.revoked_at IS NULL
      AND d.id <> ${input.deviceId}::uuid
      AND (
        EXISTS (
          SELECT 1 FROM device_product_assignments active_assignment
          WHERE active_assignment.device_id = d.id AND active_assignment.product_id = ${product.id}::uuid
            AND active_assignment.revoked_at IS NULL
        )
        OR (
          d.credential_hash IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM device_product_assignments prior
            WHERE prior.device_id = d.id AND prior.product_id = ${product.id}::uuid
          )
        )
      )
  `);
  const countRow = countResult.rows[0] as { count?: number | string } | undefined;
  const assignedOrLegacyActivatedCount = Number(countRow?.count ?? 0);
  if (!canAssignActivatedDevice(limit, assignedOrLegacyActivatedCount)) throw new DeviceProductAssignmentError("basic_device_limit_reached");

  await tx.execute(sql`
    INSERT INTO device_product_assignments (device_id, product_id, source, assigned_at)
    SELECT d.id, ${product.id}::uuid, 'legacy_basic_backfill', statement_timestamp()
    FROM devices d
    WHERE d.location_id = ${input.locationId}::uuid
      AND d.id <> ${input.deviceId}::uuid
      AND d.status = 'active' AND d.revoked_at IS NULL AND d.credential_hash IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM device_product_assignments prior
        WHERE prior.device_id = d.id AND prior.product_id = ${product.id}::uuid
      )
    ON CONFLICT DO NOTHING
  `);

  const [created] = await tx.insert(deviceProductAssignments).values({
    deviceId: input.deviceId,
    productId: product.id,
    source: "device_activation",
    assignedAt: now,
  }).onConflictDoNothing().returning({ id: deviceProductAssignments.id });
  if (created) return "assigned";

  const [concurrentAssignment] = await tx.select({ id: deviceProductAssignments.id })
    .from(deviceProductAssignments).where(and(
      eq(deviceProductAssignments.deviceId, input.deviceId),
      eq(deviceProductAssignments.productId, product.id),
      isNull(deviceProductAssignments.revokedAt),
    )).limit(1);
  return concurrentAssignment ? "existing" : "no_entitlement";
}

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
