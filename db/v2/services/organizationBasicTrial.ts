import { and, eq, isNull, sql } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialProducts, organizationCoreTrialLocations, organizationCoreTrials, organizations,
} from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "../queries/commercialProducts";
import { soundSpaBasicTrialEndsAt, SOUNDSPA_BASIC_TRIAL_DAYS } from "../queries/trialPolicy";

type Tx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

async function databaseNow(tx: Tx): Promise<Date> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const raw = (result.rows[0] as { now?: unknown } | undefined)?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  if (!Number.isFinite(now.getTime())) throw new Error("Database server time is unavailable.");
  return now;
}

/** Create the immutable organization window on first-location provisioning. */
export async function provisionFirstOrganizationBasicTrial(tx: Tx, organizationId: string, locationId: string) {
  const [organization] = await tx.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!organization) throw new Error("Organization was not found while provisioning its Basic trial.");
  const now = await databaseNow(tx);
  const [product] = await tx.select({ id: commercialProducts.id }).from(commercialProducts)
    .where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE)).limit(1);
  if (!product) throw new Error("SoundSpa Basic product is not provisioned.");

  let [trial] = await tx.select().from(organizationCoreTrials)
    .where(eq(organizationCoreTrials.organizationId, organizationId)).limit(1).for("update");
  if (!trial) {
    const [created] = await tx.insert(organizationCoreTrials).values({
      organizationId, productId: product.id, status: "active", startsAt: now,
      endsAt: soundSpaBasicTrialEndsAt(now, SOUNDSPA_BASIC_TRIAL_DAYS), origin: "first_location_creation",
      createdAt: now, updatedAt: now,
    }).onConflictDoNothing({ target: organizationCoreTrials.organizationId }).returning();
    trial = created ?? (await tx.select().from(organizationCoreTrials)
      .where(eq(organizationCoreTrials.organizationId, organizationId)).limit(1).for("update"))[0];
  }
  if (!trial || trial.productId !== product.id) throw new Error("Organization Basic trial invariant failed.");

  let [slot] = await tx.select().from(organizationCoreTrialLocations)
    .where(and(eq(organizationCoreTrialLocations.organizationId, organizationId), eq(organizationCoreTrialLocations.locationId, locationId)))
    .limit(1);
  if (!slot && trial.startsAt <= now && trial.endsAt > now) {
    const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(organizationCoreTrialLocations)
      .where(eq(organizationCoreTrialLocations.organizationTrialId, trial.id));
    const slotNumber = (countRow?.count ?? 0) + 1;
    if (slotNumber <= 5) {
      const [createdSlot] = await tx.insert(organizationCoreTrialLocations).values({
        organizationTrialId: trial.id, organizationId, locationId, slotNumber,
        source: "first_location_creation", allocatedAt: now,
      }).onConflictDoNothing().returning();
      slot = createdSlot;
    }
  }
  return { trial, slot: slot ?? null };
}

/** Allocate a lifetime slot only while the shared trial window is active. */
export async function allocateAdditionalOrganizationBasicTrialLocation(tx: Tx, organizationId: string, locationId: string) {
  const [organization] = await tx.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
  if (!organization) throw new Error("Organization was not found while allocating a Basic trial slot.");
  const now = await databaseNow(tx);
  const [trial] = await tx.select().from(organizationCoreTrials)
    .where(eq(organizationCoreTrials.organizationId, organizationId)).limit(1).for("update");
  if (!trial || trial.status !== "active" || trial.startsAt > now || trial.endsAt <= now) return null;
  const [existing] = await tx.select().from(organizationCoreTrialLocations)
    .where(and(eq(organizationCoreTrialLocations.organizationId, organizationId), eq(organizationCoreTrialLocations.locationId, locationId))).limit(1);
  if (existing) return existing;
  const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(organizationCoreTrialLocations)
    .where(eq(organizationCoreTrialLocations.organizationTrialId, trial.id));
  const slotNumber = (countRow?.count ?? 0) + 1;
  if (slotNumber > 5) return null;
  const [slot] = await tx.insert(organizationCoreTrialLocations).values({
    organizationTrialId: trial.id, organizationId, locationId, slotNumber,
    source: "additional_location_creation", allocatedAt: now,
  }).onConflictDoNothing().returning();
  return slot ?? null;
}

export async function getLocationOrganizationBasicTrial(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const [row] = await db.select({ trial: organizationCoreTrials, slot: organizationCoreTrialLocations })
    .from(organizationCoreTrialLocations)
    .innerJoin(organizationCoreTrials, and(
      eq(organizationCoreTrials.id, organizationCoreTrialLocations.organizationTrialId),
      eq(organizationCoreTrials.organizationId, organizationCoreTrialLocations.organizationId),
    ))
    .where(eq(organizationCoreTrialLocations.locationId, locationId)).limit(1);
  return row ?? null;
}

/** For consumers which need a product trial row: canonical Basic, legacy non-Basic. */
export async function getEffectiveProductTrial(locationId: string, productId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const [product] = await db.select({ id: commercialProducts.id, code: commercialProducts.code }).from(commercialProducts)
    .where(eq(commercialProducts.id, productId)).limit(1);
  if (!product) return null;
  if (product.code === SOUNDSPA_PRODUCT_CODE) {
    const row = await getLocationOrganizationBasicTrial(locationId, db);
    return row ? { status: row.trial.status, startsAt: row.trial.startsAt, endsAt: row.trial.endsAt } : null;
  }
  const { locationCoreTrials } = await import("../schema");
  const [legacy] = await db.select({ status: locationCoreTrials.status, startsAt: locationCoreTrials.startsAt, endsAt: locationCoreTrials.endsAt })
    .from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationId), eq(locationCoreTrials.productId, productId), isNull(locationCoreTrials.invalidatedByResetId))).limit(1);
  return legacy ?? null;
}
