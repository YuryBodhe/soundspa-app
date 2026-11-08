import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { commercialProductChannels, commercialProducts, locations, organizationCoreTrialLocations, organizationCoreTrials, organizations } from "../../db/v2/schema";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { SOUNDSPA_PRODUCT_CODE } from "../../db/v2/queries/commercialProducts";
import { SOUNDSPA_BASIC_TRIAL_DAYS } from "../../db/v2/queries/trialPolicy";
import { endSoundSpaTrial } from "../../db/v2/queries/coreTrials";
import { provisionFirstOrganizationBasicTrial } from "../../db/v2/services/organizationBasicTrial";

async function main() {
  let organizationId = ""; let locationId = ""; let trialId = "";
  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const [org] = await tx.insert(organizations).values({ name: `trial-${suffix}` }).returning(); organizationId = org.id;
      const [location] = await tx.insert(locations).values({ organizationId, name: "Trial", slug: `trial-${suffix}`, timezone: "UTC" }).returning(); locationId = location.id;
      const [product] = await tx.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE)); assert(product);
      const [productChannel] = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels).where(eq(commercialProductChannels.productId, product.id)); assert(productChannel);
      const { trial } = await provisionFirstOrganizationBasicTrial(tx, organizationId, locationId); trialId = trial.id;
      assert.equal(trial.productId, product.id); assert(trial.endsAt.getTime() - trial.startsAt.getTime() === SOUNDSPA_BASIC_TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const active = new Map((await resolveEffectiveChannelAccess(locationId, new Date(), tx)).map((channel) => [channel.id, channel]));
      assert(active.get(productChannel.channelId)?.accessSources.includes("trial"));
      const atExpiry = new Map((await resolveEffectiveChannelAccess(locationId, trial.endsAt, tx)).map((channel) => [channel.id, channel]));
      assert(!atExpiry.get(productChannel.channelId)?.accessSources.includes("trial"), "trial access ends at the 28-day boundary");
      const endedRequest = await endSoundSpaTrial(locationId, tx);
      assert.equal(endedRequest.status, "unsupported_shared_trial_operation", "legacy per-Location end operation is refused");
      assert.equal((await tx.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.id, trial.id)))[0]!.endsAt.getTime(), trial.endsAt.getTime(), "the legacy operation cannot mutate Organization trial dates");
      assert.equal((await tx.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.locationId, locationId))).length, 1);
      const ended = new Map((await resolveEffectiveChannelAccess(locationId, new Date(), tx)).map((channel) => [channel.id, channel]));
      assert(ended.get(productChannel.channelId)?.accessSources.includes("trial"), "Basic access remains active after a refused per-Location end request");
      throw new Error("ROLLBACK");
    });
  } catch (error) { if (!(error instanceof Error) || error.message !== "ROLLBACK") throw error; }
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  assert.equal((await v2Db.select().from(locations).where(eq(locations.id, locationId))).length, 0);
  assert.equal((await v2Db.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.id, trialId))).length, 0);
  console.info(`SoundSpa trial lifecycle PASS: ${SOUNDSPA_BASIC_TRIAL_DAYS}-day canonical Organization trial, Location slot, expiry removal, immutable end refusal, rollback.`);
  await v2Pool.end();
}
main().catch(async (error) => { console.error(error); await v2Pool.end(); process.exit(1); });
