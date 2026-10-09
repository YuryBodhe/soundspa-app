import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { endSoundSpaTrial, startSoundSpaTrial } from "../../db/v2/queries/coreTrials";
import { SOUNDSPA_BASIC_TRIAL_DAYS } from "../../db/v2/queries/trialPolicy";
import { SOUNDSPA_PRODUCT_CODE } from "../../db/v2/queries/commercialProducts";
import {
  channels,
  commercialPartnerBenefits,
  commercialPartners,
  commercialProductChannels,
  commercialProducts,
  devices,
  locationChannelGrants,
  locationCoreTrials,
  locationSubscriptions,
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
      const [spaChannel] = await tx.select().from(channels).where(eq(channels.slug, "spaquatoria"));
      assert(basic && partnerProduct && partner && spaChannel, "Provisioned Products, Partner, or Spaquatoria channel is missing.");
      assert.equal(basic.kind, "core");
      assert.equal(partnerProduct.kind, "partner");
      assert.equal(partnerProduct.isActive, true);
      assert.equal(partner.isActive, true);

      const basicChannels = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
        .where(eq(commercialProductChannels.productId, basic.id)).orderBy(asc(commercialProductChannels.channelId));
      const spaChannels = await tx.select({ channelId: commercialProductChannels.channelId }).from(commercialProductChannels)
        .where(eq(commercialProductChannels.productId, partnerProduct.id));
      assert.equal(basicChannels.length, 10, "SoundSpa Basic must retain its 10-channel composition.");
      assert.deepEqual(spaChannels.map(({ channelId }) => channelId), [spaChannel.id], "Spaquatoria Product must contain only the Spaquatoria channel.");
      const basicOnlyChannelIds = basicChannels.map(({ channelId }) => channelId).filter((channelId) => channelId !== spaChannel.id);
      assert.equal(basicOnlyChannelIds.length, 9, "The Spaquatoria channel must be included in Basic for this proof.");

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
      assert.equal(accessMap.get(spaChannel.id)?.playable, true);
      assert.deepEqual(accessMap.get(spaChannel.id)?.accessSources, ["partner_benefit"]);
      for (const channelId of basicOnlyChannelIds) {
        assert.equal(accessMap.get(channelId)?.playable, false, `Basic-only channel ${channelId} must be locked with only the Partner Benefit.`);
        assert.deepEqual(accessMap.get(channelId)?.tracks, []);
      }

      const trial = await startSoundSpaTrial(locationId, tx);
      trialId = trial.id;
      assert.equal(trial.endsAt.getTime() - trial.startsAt.getTime(), SOUNDSPA_BASIC_TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const withTrial = asMap(await resolveEffectiveChannelAccess(locationId, new Date(Date.now() + 10), tx));
      for (const channelId of basicOnlyChannelIds) {
        assert.equal(withTrial.get(channelId)?.playable, true);
        assert(withTrial.get(channelId)?.accessSources.includes("trial"));
      }
      assert.deepEqual(withTrial.get(spaChannel.id)?.accessSources, ["trial", "partner_benefit"]);

      await endSoundSpaTrial(locationId, tx);
      const afterTrial = asMap(await resolveEffectiveChannelAccess(locationId, new Date(Date.now() + 10), tx));
      for (const channelId of basicOnlyChannelIds) assert.equal(afterTrial.get(channelId)?.playable, false);
      assert.equal(afterTrial.get(spaChannel.id)?.playable, true);
      assert.deepEqual(afterTrial.get(spaChannel.id)?.accessSources, ["partner_benefit"]);

      await tx.update(commercialPartnerBenefits).set({ endsAt: new Date(), updatedAt: new Date() }).where(eq(commercialPartnerBenefits.id, benefitId));
      const afterBenefit = asMap(await resolveEffectiveChannelAccess(locationId, new Date(Date.now() + 10), tx));
      assert.equal(afterBenefit.get(spaChannel.id)?.playable, false);
      assert.deepEqual(afterBenefit.get(spaChannel.id)?.accessSources, []);
      assert.deepEqual(afterBenefit.get(spaChannel.id)?.tracks, []);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  assert.equal((await v2Db.select().from(locations).where(eq(locations.id, locationId))).length, 0);
  assert.equal((await v2Db.select().from(commercialPartnerBenefits).where(eq(commercialPartnerBenefits.id, benefitId))).length, 0);
  assert.equal((await v2Db.select().from(locationCoreTrials).where(eq(locationCoreTrials.id, trialId))).length, 0);
  console.info("Spaquatoria Partner Product access proof PASS: permanent benefit, Basic trial union/expiry, benefit end, no Base/Device grant, and transaction rollback.");
  await v2Pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await v2Pool.end();
  process.exitCode = 1;
});
