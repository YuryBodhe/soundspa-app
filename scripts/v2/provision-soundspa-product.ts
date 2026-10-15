import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { commercialProducts } from "../../db/v2/schema";
import { SOUNDSPA_PRODUCT_CODE } from "../../db/v2/queries/commercialProducts";
import {
  hasExpectedProductIdentity,
  SOUNDSPA_PRODUCT_INITIAL_CATALOG_VISIBILITY,
  soundSpaProductProvisioningUpdate,
} from "../../db/v2/services/productProvisioningModel";

async function main() {
  const existing = await v2Db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  if (!existing.length) await v2Db.insert(commercialProducts).values({
    code: SOUNDSPA_PRODUCT_CODE,
    name: "SoundSpa Basic",
    kind: "core",
    catalogVisibility: SOUNDSPA_PRODUCT_INITIAL_CATALOG_VISIBILITY,
  });
  else await v2Db.update(commercialProducts).set(soundSpaProductProvisioningUpdate(new Date())).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  const products = await v2Db.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
  assert.equal(products.length, 1);
  assert(hasExpectedProductIdentity(products[0], { code: SOUNDSPA_PRODUCT_CODE, name: "SoundSpa Basic" }), "Canonical SoundSpa Basic identity is inconsistent.");
  console.info(JSON.stringify({ id: products[0]!.id, code: products[0]!.code, name: products[0]!.name, composition: "empty" }));
  await v2Pool.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
