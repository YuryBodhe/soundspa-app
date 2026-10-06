import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { commercialProducts } from "../../db/v2/schema";
import { SOUNDSPA_PRODUCT_CODE } from "../../db/v2/queries/commercialProducts";

async function main() {
  const existing = await v2Db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  if (!existing.length) await v2Db.insert(commercialProducts).values({ code: SOUNDSPA_PRODUCT_CODE, name: "SoundSpa Basic", kind: "core" });
  else await v2Db.update(commercialProducts).set({ name: "SoundSpa Basic", updatedAt: new Date() }).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  const products = await v2Db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  assert.equal(products.length, 1);
  assert.equal(products[0]?.name, "SoundSpa Basic");
  assert.equal(products[0]?.kind, "core");
  console.info(JSON.stringify({ id: products[0]!.id, code: products[0]!.code, name: products[0]!.name, kind: products[0]!.kind, composition: "empty" }));
  await v2Pool.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
