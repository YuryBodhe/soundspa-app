import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { channels, commercialPartners, commercialProductChannels, commercialProducts } from "../../db/v2/schema";
import { SOUNDSPA_PRODUCT_CODE } from "../../db/v2/queries/commercialProducts";

const SPAQUATORIA_CODE = "spaquatoria";
const SPAQUATORIA_CHANNEL_SLUG = "spaquatoria";

async function inspectOrProvision(apply: boolean) {
  const result = await v2Db.transaction(async (tx) => {
    const [basic] = await tx.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
    assert(basic, `Required ${SOUNDSPA_PRODUCT_CODE} Product is missing.`);
    assert.equal(basic.kind, "core", "SoundSpa Basic has unexpected Product kind.");
    assert.equal(basic.isActive, true, "SoundSpa Basic is not active.");
    const basicBefore = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
      .where(eq(commercialProductChannels.productId, basic.id)).orderBy(asc(commercialProductChannels.channelId));
    assert.equal(basicBefore.length, 10, "SoundSpa Basic composition is not the accepted 10 channels; refusing to provision.");

    const [channel] = await tx.select({ id: channels.id, slug: channels.slug }).from(channels).where(eq(channels.slug, SPAQUATORIA_CHANNEL_SLUG));
    assert(channel, `Channel with stable slug ${SPAQUATORIA_CHANNEL_SLUG} was not found.`);
    assert(basicBefore.some(({ channelId }) => channelId === channel.id), "Spaquatoria is not in the accepted SoundSpa Basic composition; refusing to provision.");

    let [product] = await tx.select().from(commercialProducts).where(eq(commercialProducts.code, SPAQUATORIA_CODE));
    const productCreated = !product;
    if (product) {
      assert.equal(product.name, "Spaquatoria", "Conflicting Product name exists; refusing to overwrite.");
      assert.equal(product.kind, "partner", "Conflicting Product kind exists; refusing to overwrite.");
      assert.equal(product.isActive, true, "Spaquatoria Product exists but is inactive; refusing to overwrite.");
    } else if (apply) {
      [product] = await tx.insert(commercialProducts).values({ code: SPAQUATORIA_CODE, name: "Spaquatoria", kind: "partner", isActive: true }).returning();
    }

    let compositionCount = 0;
    if (product) {
      const existingComposition = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
        .where(eq(commercialProductChannels.productId, product.id));
      if (existingComposition.length === 0) {
        if (apply) await tx.insert(commercialProductChannels).values({ productId: product.id, channelId: channel.id }).onConflictDoNothing();
        compositionCount = apply ? 1 : 0;
      } else {
        assert.deepEqual(existingComposition.map(({ channelId }) => channelId), [channel.id], "Conflicting Spaquatoria Product composition exists; refusing to overwrite.");
        compositionCount = existingComposition.length;
      }
    }

    let [partner] = await tx.select().from(commercialPartners).where(eq(commercialPartners.code, SPAQUATORIA_CODE));
    const partnerCreated = !partner;
    if (partner) {
      assert.equal(partner.name, "Spaquatoria", "Conflicting Partner name exists; refusing to overwrite.");
      assert.equal(partner.isActive, true, "Spaquatoria Partner exists but is inactive; refusing to overwrite.");
    } else if (apply) {
      [partner] = await tx.insert(commercialPartners).values({ code: SPAQUATORIA_CODE, name: "Spaquatoria", isActive: true }).returning();
    }

    const basicAfter = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
      .where(eq(commercialProductChannels.productId, basic.id)).orderBy(asc(commercialProductChannels.channelId));
    assert.deepEqual(basicAfter, basicBefore, "SoundSpa Basic composition changed during provisioning.");
    return { product, partner, channel, compositionCount, basicCompositionCount: basicAfter.length, productCreated, partnerCreated };
  });

  console.info(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    product: result.product ? { id: result.product.id, code: result.product.code, name: result.product.name, kind: result.product.kind, active: result.product.isActive } : { code: SPAQUATORIA_CODE, name: "Spaquatoria", kind: "partner", active: true },
    productWouldBeCreated: result.productCreated,
    partner: result.partner ? { id: result.partner.id, code: result.partner.code, name: result.partner.name, active: result.partner.isActive } : { code: SPAQUATORIA_CODE, name: "Spaquatoria", active: true },
    partnerWouldBeCreated: result.partnerCreated,
    composition: result.compositionCount ? [{ channelId: result.channel.id, slug: result.channel.slug }] : [],
    compositionWouldBeAdded: result.compositionCount === 0,
    basicCompositionCount: result.basicCompositionCount,
  }));
}

const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some((argument) => argument !== "--apply")) throw new Error("Usage: tsx scripts/v2/provision-spaquatoria-product.ts [--apply]");
inspectOrProvision(apply).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await v2Pool.end();
});
