import { and, eq, isNull, desc } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialProducts, locationCoreTrials, locations } from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "./commercialProducts";
import { getLocationOrganizationBasicTrial } from "../services/organizationBasicTrial";
import { SOUNDSPA_BASIC_TRIAL_DAYS } from "./trialPolicy";

export async function getSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const canonical = await getLocationOrganizationBasicTrial(locationId, db);
  if (canonical) {
    const [product] = await db.select().from(commercialProducts).where(eq(commercialProducts.id, canonical.trial.productId)).limit(1);
    return product?.code === SOUNDSPA_PRODUCT_CODE ? { trial: canonical.trial, product } : null;
  }
  return null;
}

/** @deprecated Basic trials are Organization-scoped; retained as an idempotent compatibility wrapper. */
export async function startSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "select" | "insert" | "execute"> = v2Db, _durationDays = SOUNDSPA_BASIC_TRIAL_DAYS, _now = new Date()) {
  void _durationDays;
  void _now;
  const [location] = await db.select({ id: locations.id }).from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!location) throw new Error("Location was not found.");
  const canonical = await getLocationOrganizationBasicTrial(locationId, db);
  if (canonical) return { ...canonical.trial, productId: canonical.trial.productId };
  throw new Error("Basic trials are provisioned with the first Organization Location; legacy Basic trial creation is disabled.");
}

/** A Location-scoped end action cannot safely terminate a shared immutable trial. */
export async function endSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db, _now = new Date()) {
  void _now;
  const current = await getSoundSpaTrial(locationId, db);
  return { status: "unsupported_shared_trial_operation" as const, trial: current?.trial ?? null, deferredUntil: null as Date | null, paidStartsAt: null as Date | null };
}

export async function getLegacyNonBasicTrials(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const rows = await db.select({ trial: locationCoreTrials, product: commercialProducts })
    .from(locationCoreTrials).innerJoin(commercialProducts, eq(commercialProducts.id, locationCoreTrials.productId))
    .where(and(eq(locationCoreTrials.locationId, locationId), isNull(locationCoreTrials.invalidatedByResetId)))
    .orderBy(desc(locationCoreTrials.createdAt));
  return rows.filter((row) => row.product.code !== SOUNDSPA_PRODUCT_CODE);
}
