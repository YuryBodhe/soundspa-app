import { and, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialProductChannels, commercialProducts } from "../schema";

export const SOUNDSPA_PRODUCT_CODE = "soundspa";

export async function getSoundSpaProduct(db: Pick<typeof v2Db, "select"> = v2Db) {
  const [product] = await db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  return product ?? null;
}

export async function addProductChannel(productId: string, channelId: string, db: Pick<typeof v2Db, "insert"> = v2Db) {
  return db.insert(commercialProductChannels).values({ productId, channelId }).onConflictDoNothing().returning();
}

export async function removeProductChannel(productId: string, channelId: string, db: Pick<typeof v2Db, "delete"> = v2Db) {
  return db.delete(commercialProductChannels).where(and(eq(commercialProductChannels.productId, productId), eq(commercialProductChannels.channelId, channelId))).returning();
}
