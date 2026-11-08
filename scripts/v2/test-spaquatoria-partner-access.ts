import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { resolveCommercialProductChannelAccess } from "../../db/v2/queries/commercialAccess";
import { endSoundSpaTrial } from "../../db/v2/queries/coreTrials";
import { provisionFirstOrganizationBasicTrial } from "../../db/v2/services/organizationBasicTrial";
import { SOUNDSPA_BASIC_TRIAL_DAYS } from "../../db/v2/queries/trialPolicy";
import { SOUNDSPA_PRODUCT_CODE } from "../../db/v2/queries/commercialProducts";
import {
  commercialPartnerBenefits,
  commercialPartners,
  commercialProductChannels,
  commercialProducts,
  devices,
  locationChannelGrants,
  locationCoreTrials,
  locationSubscriptions,
  organizationCoreTrialLocations,
  organizationCoreTrials,
  locations,
  organizations,
} from "../../db/v2/schema";

class Rollback extends Error {}
type Access = Awaited<ReturnType<typeof resolveEffectiveChannelAccess>>[number];
const asMap = (rows: Access[]) => rows.reduce((map, channel) => map.set(channel.id, channel), new Map<string, Access>());

async function main() {
  let organizationId = "";
  let locationId = "";
  let benefitId = "";
  let trialId = "";

  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const [basic] = await tx.select().from(commercialProducts).where(eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE));
      const [partnerProduct] = await tx.select().from(commercialProducts).where(eq(commercialProducts.code, "spaquatoria"));
      const [partner] = await tx.select().from(commercialPartners).where(eq(commercialPartners.code, "spaquatoria"));
      assert(basic && partnerProduct && partner, "Provisioned Products or Spaquatoria Partner is missing.");
      assert.equal(basic.code, SOUNDSPA_PRODUCT_CODE, "Basic identity is established by its canonical code");
      assert.equal(basic.name, "SoundSpa Basic");
      assert.equal(partnerProduct.code, "spaquatoria", "Partner Benefit identity is established by its Product code");
      assert.equal(partnerProduct.name, "Spaquatoria");
      assert.equal(partnerProduct.isActive, true);
      assert.equal(partner.isActive, true);

      const basicChannels = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
        .where(eq(commercialProductChannels.productId, basic.id)).orderBy(asc(commercialProductChannels.channelId));
      const spaChannels = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
        .where(eq(commercialProductChannels.productId, partnerProduct.id));
      assert(basicChannels.length > 0, "SoundSpa Basic must have at least one configured channel.");
      assert(spaChannels.length > 0, "Spaquatoria must have at least one configured channel.");
      const basicChannelIds = basicChannels.map(({ channelId }) => channelId);
      const spaChannelIds = spaChannels.map(({ channelId }) => channelId);
      assert.equal(new Set(basicChannelIds).size, basicChannelIds.length, "Basic channel membership must be unique.");
      assert.equal(new Set(spaChannelIds).size, spaChannelIds.length, "Spaquatoria channel membership must be unique.");
      assert.equal(basicChannelIds.some((channelId) => spaChannelIds.includes(channelId)), false,
        "Spaquatoria channels must remain separate from the SoundSpa Basic product.");

      const [organization] = await tx.insert(organizations).values({ name: `spaquatoria-proof-${suffix}` }).returning();
      organizationId = organization.id;
      const [location] = await tx.insert(locations).values({ organizationId, name: "Partner Access Proof", slug: `spaquatoria-proof-${suffix}`, timezone: "UTC" }).returning();
      locationId = location.id;

      assert.equal((await tx.select().from(locationCoreTrials).where(eq(locationCoreTrials.locationId, locationId))).length, 0);
      assert.equal((await tx.select().from(locationSubscriptions).where(eq(locationSubscriptions.locationId, locationId))).length, 0);
      assert.equal((await tx.select().from(locationChannelGrants).where(eq(locationChannelGrants.locationId, locationId))).length, 0);
      assert.equal((await tx.select().from(devices).where(eq(devices.locationId, locationId))).length, 0);

      const now = new Date();
      const [benefit] = await tx.insert(commercialPartnerBenefits).values({
        partnerId: partner.id,
        productId: partnerProduct.id,
        locationId,
        startsAt: new Date(now.getTime() - 1_000),
        endsAt: null,
      }).returning();
      benefitId = benefit.id;

      const accessMap = asMap(await resolveEffectiveChannelAccess(locationId, now, tx));
      const benefitOnlyProductAccess = await resolveCommercialProductChannelAccess(locationId, now, tx);
      assert.deepEqual([...benefitOnlyProductAccess.keys()], [partnerProduct.id], "Partner Benefit must grant only the Spaquatoria Product.");
      for (const [channelId, sources] of benefitOnlyProductAccess.get(partnerProduct.id)!) {
        assert(spaChannelIds.includes(channelId), "Partner Benefit must expose only configured Spaquatoria channels.");
        assert.deepEqual([...sources], ["partner_benefit"]);
      }
      for (const channelId of spaChannelIds) {
        assert.equal(accessMap.get(channelId)?.playable, true);
        assert.deepEqual(accessMap.get(channelId)?.accessSources, ["partner_benefit"]);
      }
      for (const channelId of basicChannelIds) {
        assert.equal(accessMap.get(channelId)?.playable, false, `Basic channel ${channelId} must be locked with only the Spaquatoria Benefit.`);
        assert.deepEqual(accessMap.get(channelId)?.tracks, []);
      }

      const { trial } = await provisionFirstOrganizationBasicTrial(tx, organizationId, locationId);
      trialId = trial.id;
      assert.equal(trial.endsAt.getTime() - trial.startsAt.getTime(), SOUNDSPA_BASIC_TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const withTrial = asMap(await resolveEffectiveChannelAccess(locationId, new Date(Date.now() + 10), tx));
      const trialAndBenefitProductAccess = await resolveCommercialProductChannelAccess(locationId, new Date(Date.now() + 10), tx);
      assert.deepEqual([...trialAndBenefitProductAccess.keys()].sort(), [basic.id, partnerProduct.id].sort());
      assert.equal(trialAndBenefitProductAccess.get(basic.id)!.size, basicChannelIds.length);
      assert.equal(trialAndBenefitProductAccess.get(partnerProduct.id)!.size, spaChannelIds.length);
      for (const channelId of basicChannelIds) {
        assert.equal(withTrial.get(channelId)?.playable, true);
        assert(withTrial.get(channelId)?.accessSources.includes("trial"));
        assert.deepEqual(withTrial.get(channelId)?.productAccessSources[basic.id], ["trial"]);
        assert.equal(withTrial.get(channelId)?.productAccessSources[partnerProduct.id], undefined);
      }
      for (const channelId of spaChannelIds) {
        assert.equal(withTrial.get(channelId)?.playable, true);
        assert.deepEqual(withTrial.get(channelId)?.accessSources, ["partner_benefit"]);
        assert.deepEqual(withTrial.get(channelId)?.productAccessSources[partnerProduct.id], ["partner_benefit"]);
        assert.equal(withTrial.get(channelId)?.productAccessSources[basic.id], undefined);
      }

      const endResult = await endSoundSpaTrial(locationId, tx);
      assert.equal(endResult.status, "unsupported_shared_trial_operation", "a per-Location operator action cannot end the shared Organization trial");
      const afterTrial = asMap(await resolveEffectiveChannelAccess(locationId, new Date(Date.now() + 10), tx));
      for (const channelId of basicChannelIds) assert.equal(afterTrial.get(channelId)?.playable, true, "refusing early termination preserves existing Basic access");
      for (const channelId of spaChannelIds) {
        assert.equal(afterTrial.get(channelId)?.playable, true);
        assert.deepEqual(afterTrial.get(channelId)?.accessSources, ["partner_benefit"]);
      }

      await tx.update(commercialPartnerBenefits).set({ endsAt: trial.endsAt, updatedAt: new Date() }).where(eq(commercialPartnerBenefits.id, benefitId));
      const afterBenefit = asMap(await resolveEffectiveChannelAccess(locationId, trial.endsAt, tx));
      for (const channelId of basicChannelIds) assert.equal(afterBenefit.get(channelId)?.playable, false, "Basic trial ends at its immutable shared boundary");
      for (const channelId of spaChannelIds) {
        assert.equal(afterBenefit.get(channelId)?.playable, false, "Spaquatoria Benefit stops at its own half-open boundary");
        assert.deepEqual(afterBenefit.get(channelId)?.accessSources, []);
        assert.deepEqual(afterBenefit.get(channelId)?.tracks, []);
      }

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  assert.equal((await v2Db.select().from(locations).where(eq(locations.id, locationId))).length, 0);
  assert.equal((await v2Db.select().from(commercialPartnerBenefits).where(eq(commercialPartnerBenefits.id, benefitId))).length, 0);
  assert.equal((await v2Db.select().from(organizationCoreTrials).where(eq(organizationCoreTrials.id, trialId))).length, 0);
  assert.equal((await v2Db.select().from(organizationCoreTrialLocations).where(eq(organizationCoreTrialLocations.locationId, locationId))).length, 0);
  console.info("Spaquatoria Partner Product access proof PASS: product-based catalog membership, independent Benefit and Basic trial, canonical trial expiry, immutable trial end refusal, no device grant, and transaction rollback.");
  await v2Pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await v2Pool.end();
  process.exitCode = 1;
});
