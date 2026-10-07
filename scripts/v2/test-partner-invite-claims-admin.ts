import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { listPartnerInviteClaimLocations, listPartnerOfferInviteClaims } from "../../db/v2/services/partnerOfferAdmin";
import { adminClaimPartnerInvite, claimPartnerInvite, PartnerInviteClaimError } from "../../db/v2/services/partnerInviteClaims";
import {
  channels,
  commercialOfferGrants,
  commercialOffers,
  commercialPartnerBenefits,
  commercialPartnerInviteClaims,
  commercialPartnerInvites,
  commercialPartners,
  commercialProductChannels,
  commercialProducts,
  locationCoreTrials,
  locations,
  organizations,
} from "../../db/v2/schema";

class Rollback extends Error {}
type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
const DAY_MS = 86_400_000;

async function expectClaimError(operation: Promise<unknown>, code: ConstructorParameters<typeof PartnerInviteClaimError>[0]) {
  await assert.rejects(operation, (error: unknown) => error instanceof PartnerInviteClaimError && error.code === code);
}

async function main() {
  const fixtureInviteIds: string[] = [];
  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const runner: TransactionRunner = <T>(operation: (inner: V2Transaction) => Promise<T>) => tx.transaction(operation);
      const now = new Date();
      const [organization] = await tx.insert(organizations).values({ name: `P4C test organization ${suffix}` }).returning();
      const [locationA] = await tx.insert(locations).values({ organizationId: organization.id, name: "P4C location A", slug: `p4c-a-${suffix}`, timezone: "UTC" }).returning();
      const [locationB] = await tx.insert(locations).values({ organizationId: organization.id, name: "P4C location B", slug: `p4c-b-${suffix}`, timezone: "UTC" }).returning();
      const [archivedOrganization] = await tx.insert(organizations).values({ name: `P4C archived organization ${suffix}`, archivedAt: now }).returning();
      const [archivedLocation] = await tx.insert(locations).values({ organizationId: archivedOrganization.id, name: "Archived P4C location", slug: `p4c-archived-${suffix}`, timezone: "UTC" }).returning();
      const [partner] = await tx.insert(commercialPartners).values({ code: `p4c-${suffix}`, name: "P4C Partner" }).returning();
      const [benefitProduct] = await tx.insert(commercialProducts).values({ code: `p4c-benefit-${suffix}`, name: "P4C Partner Benefit", kind: "partner" }).returning();
      const [trialProduct] = await tx.insert(commercialProducts).values({ code: `p4c-trial-${suffix}`, name: "P4C Trial", kind: "core" }).returning();
      const [benefitChannel] = await tx.insert(channels).values({ slug: `p4c-benefit-${suffix}`, displayName: "P4C Benefit Channel", kind: "music", isPublished: true }).returning();
      const [trialChannel] = await tx.insert(channels).values({ slug: `p4c-trial-${suffix}`, displayName: "P4C Trial Channel", kind: "music", isPublished: true }).returning();
      await tx.insert(commercialProductChannels).values([
        { productId: benefitProduct.id, channelId: benefitChannel.id },
        { productId: trialProduct.id, channelId: trialChannel.id },
      ]);

      const [offer] = await tx.insert(commercialOffers).values({ partnerId: partner.id, code: `p4c-${suffix}`, name: "P4C Offer" }).returning();
      await tx.insert(commercialOfferGrants).values([
        { offerId: offer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null },
        { offerId: offer.id, productId: trialProduct.id, grantType: "trial", durationDays: 30 },
      ]);

      async function insertInvite(options: { maxClaims?: number | null; expiresAt?: Date | null; revokedAt?: Date | null; token?: string } = {}) {
        const tokenForHash = options.token ?? `p4c-unrecoverable-${randomUUID()}`;
        const createdAt = options.expiresAt ? new Date(options.expiresAt.getTime() - DAY_MS) : now;
        const [invite] = await tx.insert(commercialPartnerInvites).values({
          offerId: offer.id,
          tokenHash: createHash("sha256").update(tokenForHash, "utf8").digest("hex"),
          maxClaims: options.maxClaims ?? null,
          expiresAt: options.expiresAt ?? null,
          revokedAt: options.revokedAt ?? null,
          createdAt,
        }).returning();
        fixtureInviteIds.push(invite.id);
        return { invite, token: options.token };
      }

      const limited = await insertInvite({ maxClaims: 1 });
      assert.equal(limited.token, undefined, "Admin identity claim needs only the Invite ID, not a plaintext token");
      const claim = await adminClaimPartnerInvite({ inviteId: limited.invite.id, locationId: locationA.id }, runner);
      assert.equal(claim.status, "claimed");
      if (claim.status !== "claimed") throw new Error("Expected a new operator claim.");
      assert.deepEqual(claim.benefits.map((item) => item.productId), [benefitProduct.id]);
      assert.deepEqual(claim.trials, [{ productId: trialProduct.id, result: "created" }]);

      const retry = await adminClaimPartnerInvite({ inviteId: limited.invite.id, locationId: locationA.id }, runner);
      assert.equal(retry.status, "already_claimed", "same Location retry is idempotent even at max_claims");
      await expectClaimError(adminClaimPartnerInvite({ inviteId: limited.invite.id, locationId: locationB.id }, runner), "MAX_CLAIMS_EXHAUSTED");
      assert.equal((await tx.select().from(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, limited.invite.id))).length, 1);
      assert.equal((await tx.select().from(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.partnerId, partner.id), eq(commercialPartnerBenefits.productId, benefitProduct.id), eq(commercialPartnerBenefits.locationId, locationA.id)))).length, 1);
      assert.equal((await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationA.id), eq(locationCoreTrials.productId, trialProduct.id)))).length, 1);

      const history = await listPartnerOfferInviteClaims(offer.id, tx);
      const inviteHistory = history.filter((item) => item.inviteId === limited.invite.id);
      assert.equal(inviteHistory.length, 1);
      assert.equal(inviteHistory[0]?.organizationName, organization.name);
      assert.equal(inviteHistory[0]?.locationName, locationA.name);
      assert.equal(inviteHistory[0]?.locationSlug, locationA.slug);
      const [claimRow] = await tx.select().from(commercialPartnerInviteClaims).where(and(eq(commercialPartnerInviteClaims.inviteId, limited.invite.id), eq(commercialPartnerInviteClaims.locationId, locationA.id)));
      assert.equal(inviteHistory[0]?.claimedAt.getTime(), claimRow?.claimedAt.getTime());
      assert.equal(history.filter((item) => item.inviteId === limited.invite.id && item.locationSlug === locationB.slug).length, 0, "claim history stays scoped to the claimed Location");
      const locationsForClaim = await listPartnerInviteClaimLocations(tx);
      assert(locationsForClaim.some((item) => item.id === locationA.id && item.organizationName === organization.name));
      assert.equal(locationsForClaim.some((item) => item.id === archivedLocation.id), false, "archived Organizations/Locations are not selectable");

      const effectiveAccess = new Map((await resolveEffectiveChannelAccess(locationA.id, new Date(), tx)).map((item) => [item.id, item]));
      assert(effectiveAccess.get(benefitChannel.id)?.accessSources.includes("partner_benefit"));
      assert(effectiveAccess.get(trialChannel.id)?.accessSources.includes("trial"));

      const publicToken = `p4c-public-${suffix}`;
      const tokenInvite = await insertInvite({ token: publicToken });
      assert.equal((await claimPartnerInvite({ token: tokenInvite.token!, locationId: locationB.id }, runner)).status, "claimed", "public token entry point remains functional");
      assert.equal((await tx.select().from(commercialPartnerInviteClaims).where(and(eq(commercialPartnerInviteClaims.inviteId, tokenInvite.invite.id), eq(commercialPartnerInviteClaims.locationId, locationB.id)))).length, 1);
      assert.equal("tokenHash" in (await listPartnerOfferInviteClaims(offer.id, tx))[0]!, false, "claim history never returns Invite token material");

      await expectClaimError(adminClaimPartnerInvite({ inviteId: randomUUID(), locationId: locationA.id }, runner), "INVITE_UNAVAILABLE");
      await expectClaimError(adminClaimPartnerInvite({ inviteId: limited.invite.id, locationId: randomUUID() }, runner), "LOCATION_UNAVAILABLE");
      await expectClaimError(adminClaimPartnerInvite({ inviteId: "invalid", locationId: locationA.id }, runner), "INVITE_UNAVAILABLE");

      const revoked = await insertInvite({ revokedAt: now });
      await expectClaimError(adminClaimPartnerInvite({ inviteId: revoked.invite.id, locationId: locationB.id }, runner), "INVITE_UNAVAILABLE");
      const expired = await insertInvite({ expiresAt: new Date(now.getTime() - 1) });
      await expectClaimError(adminClaimPartnerInvite({ inviteId: expired.invite.id, locationId: locationB.id }, runner), "INVITE_UNAVAILABLE");

      const [inactiveOffer] = await tx.insert(commercialOffers).values({ partnerId: partner.id, code: `p4c-off-inactive-${suffix}`, name: "Inactive P4C Offer", isActive: false }).returning();
      await tx.insert(commercialOfferGrants).values({ offerId: inactiveOffer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null });
      const [inactiveOfferInvite] = await tx.insert(commercialPartnerInvites).values({ offerId: inactiveOffer.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex") }).returning(); fixtureInviteIds.push(inactiveOfferInvite.id);
      await expectClaimError(adminClaimPartnerInvite({ inviteId: inactiveOfferInvite.id, locationId: locationB.id }, runner), "OFFER_INACTIVE");

      const [inactivePartner] = await tx.insert(commercialPartners).values({ code: `p4c-inactive-${suffix}`, name: "Inactive P4C Partner", isActive: false }).returning();
      const [inactivePartnerOffer] = await tx.insert(commercialOffers).values({ partnerId: inactivePartner.id, code: `p4c-partner-off-${suffix}`, name: "Inactive Partner Offer" }).returning();
      await tx.insert(commercialOfferGrants).values({ offerId: inactivePartnerOffer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null });
      const [inactivePartnerInvite] = await tx.insert(commercialPartnerInvites).values({ offerId: inactivePartnerOffer.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex") }).returning(); fixtureInviteIds.push(inactivePartnerInvite.id);
      await expectClaimError(adminClaimPartnerInvite({ inviteId: inactivePartnerInvite.id, locationId: locationB.id }, runner), "PARTNER_INACTIVE");

      const [emptyOffer] = await tx.insert(commercialOffers).values({ partnerId: partner.id, code: `p4c-empty-${suffix}`, name: "Empty P4C Offer" }).returning();
      const [emptyInvite] = await tx.insert(commercialPartnerInvites).values({ offerId: emptyOffer.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex") }).returning(); fixtureInviteIds.push(emptyInvite.id);
      await expectClaimError(adminClaimPartnerInvite({ inviteId: emptyInvite.id, locationId: locationB.id }, runner), "INVALID_OFFER_CONFIGURATION");

      const disabledLocation = await tx.update(locations).set({ archivedAt: now }).where(eq(locations.id, locationB.id)).returning({ id: locations.id });
      assert.equal(disabledLocation.length, 1);
      await expectClaimError(adminClaimPartnerInvite({ inviteId: tokenInvite.invite.id, locationId: locationB.id }, runner), "LOCATION_UNAVAILABLE");

      throw new Rollback();
    }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    assert.equal((await v2Db.select().from(commercialPartnerInvites).where(inArray(commercialPartnerInvites.id, fixtureInviteIds))).length, 0, "rollback removes all generated Invite fixtures");
    assert.equal((await v2Db.select().from(commercialPartnerInviteClaims).where(inArray(commercialPartnerInviteClaims.inviteId, fixtureInviteIds))).length, 0, "rollback removes claim history fixtures");
    console.info("Partner Invite Admin Claims integration PASS: shared P3 engine, benefit/trial application, effective access, claim history/location scope, idempotency/max claims, lifecycle and eligibility failures, public token path, and fixture rollback.");
  } finally {
    await v2Pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
