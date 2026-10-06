import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { baseChannels, channelTracks, channels, commercialPartnerBenefits, commercialPartners, commercialProductChannels, commercialProducts, locationCoreTrials, locationSubscriptions, locations, organizations, locationChannelGrants } from "../../db/v2/schema";

class Rollback extends Error {}
async function main() {
  let organizationId = "", locationA = "", locationB = "", channelIds: string[] = [];
  try {
    await v2Db.transaction(async (tx) => {
      const now = new Date("2026-10-06T12:00:00.000Z"), future = new Date("2026-10-07T12:00:00.000Z"), past = new Date("2026-10-05T12:00:00.000Z"), suffix = randomUUID();
      const [org] = await tx.insert(organizations).values({ name: `commercial-${suffix}` }).returning(); organizationId = org.id;
      const [a] = await tx.insert(locations).values({ organizationId: org.id, name: "Location A", slug: `commercial-a-${suffix}`, timezone: "UTC" }).returning(); locationA = a.id;
      const [b] = await tx.insert(locations).values({ organizationId: org.id, name: "Location B", slug: `commercial-b-${suffix}`, timezone: "UTC" }).returning(); locationB = b.id;
      const makeChannel = async (slug: string) => { const [channel] = await tx.insert(channels).values({ slug: `${slug}-${suffix}`, displayName: slug, kind: "music", isPublished: true }).returning(); channelIds.push(channel.id); await tx.insert(channelTracks).values({ channelId: channel.id, storageKey: `synthetic/${suffix}/${slug}.mp3`, originalFilename: `${slug}.mp3`, sizeBytes: BigInt(1), sortOrder: 0 }); return channel.id; };
      const coreA = await makeChannel("core-a"), coreB = await makeChannel("core-b"), partner = await makeChannel("partner"), addon = await makeChannel("addon"), admin = await makeChannel("admin");
      const [core] = await tx.insert(commercialProducts).values({ code: `core-${suffix}`, name: "Core", kind: "core", priceMinor: 108000, currency: "RUB", billingIntervalMonths: 1 }).returning();
      const [partnerProduct] = await tx.insert(commercialProducts).values({ code: `partner-${suffix}`, name: "Partner", kind: "partner" }).returning();
      const [addonProduct] = await tx.insert(commercialProducts).values({ code: `addon-${suffix}`, name: "Add-on", kind: "addon" }).returning();
      await tx.insert(commercialProductChannels).values([{ productId: core.id, channelId: coreA }, { productId: core.id, channelId: coreB }, { productId: partnerProduct.id, channelId: partner }, { productId: addonProduct.id, channelId: addon }]);
      const [partnerRow] = await tx.insert(commercialPartners).values({ code: `partner-${suffix}`, name: "Generic Partner" }).returning();
      await tx.insert(locationCoreTrials).values({ locationId: locationA, productId: core.id, status: "active", startsAt: past, endsAt: future });
      await tx.insert(commercialPartnerBenefits).values({ locationId: locationA, productId: partnerProduct.id, partnerId: partnerRow.id, startsAt: past, endsAt: null });
      await tx.insert(locationSubscriptions).values({ locationId: locationA, productId: addonProduct.id, provider: "staging", status: "active", startsAt: past, currentPeriodEndsAt: future });
      await tx.insert(locationSubscriptions).values({ locationId: locationB, productId: core.id, provider: "manual", status: "active", startsAt: past, currentPeriodEndsAt: future });
      await tx.insert(baseChannels).values({ channelId: admin });
      await tx.insert(locationChannelGrants).values({ locationId: locationA, channelId: admin, source: "admin", enabled: true });
      const accessA = new Map((await resolveEffectiveChannelAccess(locationA, now, tx)).map((channel) => [channel.id, channel]));
      assert.deepEqual(accessA.get(coreA)?.accessSources, ["trial"]); assert.deepEqual(accessA.get(coreB)?.accessSources, ["trial"]); assert.deepEqual(accessA.get(partner)?.accessSources, ["partner_benefit"]); assert.deepEqual(accessA.get(addon)?.accessSources, ["subscription"]); assert.deepEqual(accessA.get(admin)?.accessSources, ["base", "admin"]);
      const accessB = new Map((await resolveEffectiveChannelAccess(locationB, now, tx)).map((channel) => [channel.id, channel])); assert.deepEqual(accessB.get(coreA)?.accessSources, ["subscription"]); assert.deepEqual(accessB.get(partner)?.accessSources, []);
      await tx.update(locationCoreTrials).set({ status: "expired" }).where(eq(locationCoreTrials.locationId, locationA));
      const afterTrial = new Map((await resolveEffectiveChannelAccess(locationA, now, tx)).map((channel) => [channel.id, channel])); assert.deepEqual(afterTrial.get(coreA)?.accessSources, []); assert.deepEqual(afterTrial.get(partner)?.accessSources, ["partner_benefit"]); assert.deepEqual(afterTrial.get(addon)?.accessSources, ["subscription"]); assert.deepEqual(afterTrial.get(admin)?.accessSources, ["base", "admin"]);
      await tx.update(locationSubscriptions).set({ status: "expired", currentPeriodEndsAt: past }).where(eq(locationSubscriptions.locationId, locationA));
      const afterSubscription = new Map((await resolveEffectiveChannelAccess(locationA, now, tx)).map((channel) => [channel.id, channel])); assert.deepEqual(afterSubscription.get(addon)?.accessSources, []);
      throw new Rollback();
    });
  } catch (error) { if (!(error instanceof Rollback)) throw error; }
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  console.info("Commercial access integration A-M PASS: trial, subscription, partner benefit, add-on, independent expiry, Base/admin coexistence, duplicate-safe source union, Location isolation, and rollback.");
  await v2Pool.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
