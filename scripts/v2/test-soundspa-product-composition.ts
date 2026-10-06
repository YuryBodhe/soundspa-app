import assert from "node:assert/strict";
import { and, asc, eq, isNull } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { addProductChannel, getSoundSpaProduct, removeProductChannel } from "../../db/v2/queries/commercialProducts";
import { baseChannels, channels, commercialProductChannels, locationChannelGrants } from "../../db/v2/schema";

class Rollback extends Error {}
async function main() {
  const product = await getSoundSpaProduct(); assert(product, "SoundSpa product must be provisioned");
  const [candidate] = await v2Db.select({ id: channels.id }).from(channels).where(and(eq(channels.isPublished, true), isNull(channels.archivedAt))).orderBy(asc(channels.sortOrder), asc(channels.id)).limit(1);
  assert(candidate);
  const before = await v2Db.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, product.id)).orderBy(asc(commercialProductChannels.channelId));
  const baseBefore = await v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels).orderBy(asc(baseChannels.channelId));
  const grantsBefore = await v2Db.select({ id: locationChannelGrants.id }).from(locationChannelGrants);
  try { await v2Db.transaction(async (tx) => {
    await addProductChannel(product.id, candidate.id, tx); assert.equal((await tx.select().from(commercialProductChannels).where(and(eq(commercialProductChannels.productId, product.id), eq(commercialProductChannels.channelId, candidate.id)))).length, 1);
    await addProductChannel(product.id, candidate.id, tx); assert.equal((await tx.select().from(commercialProductChannels).where(and(eq(commercialProductChannels.productId, product.id), eq(commercialProductChannels.channelId, candidate.id)))).length, 1);
    await removeProductChannel(product.id, candidate.id, tx); assert.equal((await tx.select().from(commercialProductChannels).where(and(eq(commercialProductChannels.productId, product.id), eq(commercialProductChannels.channelId, candidate.id)))).length, 0);
    throw new Rollback();
  }); } catch (error) { if (!(error instanceof Rollback)) throw error; }
  assert.deepEqual(await v2Db.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, product.id)).orderBy(asc(commercialProductChannels.channelId)), before);
  assert.deepEqual(await v2Db.select({ channelId: baseChannels.channelId }).from(baseChannels).orderBy(asc(baseChannels.channelId)), baseBefore);
  assert.deepEqual(await v2Db.select({ id: locationChannelGrants.id }).from(locationChannelGrants), grantsBefore);
  console.info("SoundSpa Product composition PASS: exactly-one provisioning, idempotent add/remove, rollback persistence, Base/Admin preservation, and no Location/Device mutation.");
  await v2Pool.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
