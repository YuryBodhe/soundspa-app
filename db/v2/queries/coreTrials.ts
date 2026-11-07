import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialProducts, locationCoreTrials, locationSubscriptions, locations } from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "./commercialProducts";
import { planSafeTrialTermination, SOUNDSPA_BASIC_TRIAL_DAYS, soundSpaBasicTrialEndsAt } from "./trialPolicy";

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

type EndTrialTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type EndTrialDb = Pick<typeof v2Db, "update" | "select"> & Partial<Pick<typeof v2Db, "transaction">>;

async function endSoundSpaTrialInTransaction(locationId: string, db: Pick<typeof v2Db, "update" | "select">, now: Date) {
  // Billing checkouts and payment settlement use the Location row as their
  // serialization point too, so a paid period cannot race past this decision.
  const [location] = await db.select({ id: locations.id }).from(locations).where(eq(locations.id, locationId)).for("update").limit(1);
  if (!location) throw new Error("Location was not found.");
  const existing = await getSoundSpaTrial(locationId, db);
  if (!existing || existing.trial.status !== "active" || existing.trial.startsAt > now || existing.trial.endsAt <= now) {
    throw new Error("No active SoundSpa Basic trial exists.");
  }

  const paidPeriods = await db.select({ startsAt: locationSubscriptions.startsAt, endsAt: locationSubscriptions.currentPeriodEndsAt })
    .from(locationSubscriptions).where(and(
      eq(locationSubscriptions.locationId, locationId),
      eq(locationSubscriptions.productId, existing.trial.productId),
      isNull(locationSubscriptions.invalidatedByResetId),
      // Canceled subscriptions retain their paid coverage through the period.
      // Expired rows do not grant access and must not defer a trial end.
      inArray(locationSubscriptions.status, ["active", "canceled"]),
    ));
  const continuity = planSafeTrialTermination({ now, naturalTrialEnd: existing.trial.endsAt, paidPeriods });
  if (continuity) {
    const deferredUntil = new Date(Math.max(existing.trial.endsAt.getTime(), continuity.deferredUntil.getTime()));
    if (deferredUntil > existing.trial.endsAt) {
      const [trial] = await db.update(locationCoreTrials).set({ endsAt: deferredUntil, updatedAt: now })
        .where(eq(locationCoreTrials.id, existing.trial.id)).returning();
      return { trial, deferredUntil, paidStartsAt: continuity.paidStartsAt };
    }
    // A period beginning at the original trial boundary needs no stored change;
    // date-based access ends the trial exactly as paid access begins.
    return { trial: existing.trial, deferredUntil, paidStartsAt: continuity.paidStartsAt };
  }

  const [trial] = await db.update(locationCoreTrials).set({ status: "expired", endsAt: now, updatedAt: now })
    .where(eq(locationCoreTrials.id, existing.trial.id)).returning();
  return { trial, deferredUntil: null, paidStartsAt: null };
}

export async function endSoundSpaTrial(locationId: string, db: EndTrialDb = v2Db, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid trial termination date.");
  if (db.transaction) return db.transaction((tx: EndTrialTx) => endSoundSpaTrialInTransaction(locationId, tx, now));
  return endSoundSpaTrialInTransaction(locationId, db, now);
}
