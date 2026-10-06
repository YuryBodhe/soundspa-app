import { and, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialProducts, locationCoreTrials } from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "./commercialProducts";

const TRIAL_DAYS = 30;

export async function getSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "select"> = v2Db) {
  const [row] = await db.select({ trial: locationCoreTrials, product: commercialProducts })
    .from(locationCoreTrials).innerJoin(commercialProducts, eq(commercialProducts.id, locationCoreTrials.productId))
    .where(and(eq(locationCoreTrials.locationId, locationId), eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE)));
  return row ?? null;
}

export async function startSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "insert" | "select"> = v2Db) {
  const product = await db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  if (!product[0]) throw new Error("SoundSpa product is not provisioned.");
  const existing = await getSoundSpaTrial(locationId, db);
  if (existing) throw new Error("This Location has already used its SoundSpa Basic trial.");
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const [trial] = await db.insert(locationCoreTrials).values({ locationId, productId: product[0].id, status: "active", startsAt, endsAt }).returning();
  return trial;
}

export async function endSoundSpaTrial(locationId: string, db: Pick<typeof v2Db, "update" | "select"> = v2Db) {
  const existing = await getSoundSpaTrial(locationId, db);
  if (!existing || existing.trial.status !== "active") throw new Error("No active SoundSpa Basic trial exists.");
  const endedAt = new Date();
  const [trial] = await db.update(locationCoreTrials).set({ status: "expired", endsAt: endedAt, updatedAt: endedAt }).where(eq(locationCoreTrials.id, existing.trial.id)).returning();
  return trial;
}
