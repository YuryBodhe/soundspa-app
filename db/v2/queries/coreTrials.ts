import { and, desc, eq, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialProducts, locationCoreTrials, locations } from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "./commercialProducts";
import { SOUNDSPA_BASIC_TRIAL_DAYS, soundSpaBasicTrialEndsAt } from "./trialPolicy";

export async function getSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const [row] = await db.select({ trial: locationCoreTrials, product: commercialProducts })
    .from(locationCoreTrials).innerJoin(commercialProducts, eq(commercialProducts.id, locationCoreTrials.productId))
    .where(and(eq(locationCoreTrials.locationId, locationId), isNull(locationCoreTrials.invalidatedByResetId), eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE)))
    .orderBy(desc(locationCoreTrials.createdAt)).limit(1);
  return row ?? null;
}

type TrialTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TrialDb = Pick<typeof v2Db, "insert" | "select"> & Partial<Pick<typeof v2Db, "transaction">>;

async function insertSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "insert" | "select">, durationDays: number, now: Date) {
  const [location] = await db.select({ id: locations.id }).from(locations).where(eq(locations.id, locationId)).for("update").limit(1);
  if (!location) throw new Error("Location was not found.");
  const product = await db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  if (!product[0]) throw new Error("SoundSpa product is not provisioned.");
  const existing = await getSoundSpaTrial(locationId, db);
  if (existing) throw new Error("This Location has already used its SoundSpa Basic trial.");
  const startsAt = now;
  const endsAt = soundSpaBasicTrialEndsAt(startsAt, durationDays);
  const [trial] = await db.insert(locationCoreTrials).values({ locationId, productId: product[0].id, status: "active", startsAt, endsAt }).returning();
  return trial;
}

export async function startSoundSpaTrial(locationId: string, db: TrialDb = v2Db, durationDays = SOUNDSPA_BASIC_TRIAL_DAYS, now = new Date()) {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365 || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid SoundSpa trial duration.");
  }
  if (db.transaction) return db.transaction((tx: TrialTx) => insertSoundSpaTrial(locationId, tx, durationDays, now));
  return insertSoundSpaTrial(locationId, db, durationDays, now);
}

export async function endSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "update" | "select"> = v2Db) {
  const existing = await getSoundSpaTrial(locationId, db);
  if (!existing || existing.trial.status !== "active") throw new Error("No active SoundSpa Basic trial exists.");
  const endedAt = new Date();
  const [trial] = await db.update(locationCoreTrials).set({ status: "expired", endsAt: endedAt, updatedAt: endedAt }).where(eq(locationCoreTrials.id, existing.trial.id)).returning();
  return trial;
}
