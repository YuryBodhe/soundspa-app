import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { resolveEffectiveChannelAccess } from "../../db/v2/queries/effectiveAccess";
import { claimPartnerInvite, claimPartnerInviteByHash, PartnerInviteClaimError, type PartnerInviteClaimErrorCode } from "../../db/v2/services/partnerInviteClaims";
import {
  channelTracks,
  channels,
  commercialOfferGrants,
  commercialOffers,
  commercialPaymentProviders,
  commercialPartnerBenefits,
  commercialPartnerInviteClaims,
  commercialPartnerInvites,
  commercialPartners,
  commercialProductChannels,
  commercialProducts,
  locationChannelGrants,
  locationCoreTrials,
  locationSubscriptions,
  locations,
  organizations,
} from "../../db/v2/schema";

class Rollback extends Error {}
type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
const DAY_MS = 24 * 60 * 60 * 1000;

function getPostgresCode(error: unknown): string | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

async function expectDomainError(operation: Promise<unknown>, code: PartnerInviteClaimErrorCode) {
  await assert.rejects(operation, (error: unknown) => error instanceof PartnerInviteClaimError && error.code === code);
}

async function main() {
  try {
    await v2Db.transaction(async (tx) => {
      const suffix = randomUUID();
      const runner = <T>(operation: (inner: V2Transaction) => Promise<T>) => tx.transaction(operation);
      const now = new Date();
      const past = new Date(now.getTime() - DAY_MS);
      const ended = new Date(now.getTime() - DAY_MS / 2);
      const future = new Date(now.getTime() + 40 * DAY_MS);
      const [organization] = await tx.insert(organizations).values({ name: `p3-claims-${suffix}` }).returning();
      const [locationA] = await tx.insert(locations).values({ organizationId: organization.id, name: "Claim location A", slug: `p3-claim-a-${suffix}`, timezone: "UTC" }).returning();
      const [locationB] = await tx.insert(locations).values({ organizationId: organization.id, name: "Claim location B", slug: `p3-claim-b-${suffix}`, timezone: "UTC" }).returning();
      const providerCode = `test-${suffix}`;
      await tx.insert(commercialPaymentProviders).values({ code: providerCode, displayName: "Rollback-only test provider" });
      const [partner] = await tx.insert(commercialPartners).values({ code: `p3-partner-${suffix}`, name: "P3 Partner" }).returning();
      const product = async (code: string, kind: "core" | "partner", isActive = true) => {
        const [row] = await tx.insert(commercialProducts).values({ code: `${code}-${suffix}`, name: code, kind, isActive }).returning();
        return row;
      };
      const permanentProduct = await product("permanent", "partner");
      const timedProduct = await product("timed", "partner");
      const trialProduct = await product("trial", "core");
      const activeTrialProduct = await product("active-trial", "core");
      const usedTrialProduct = await product("used-trial", "core");
      const paidTrialProduct = await product("paid-trial", "core");
      const rollbackBenefitProduct = await product("rollback-benefit", "partner");
      const rollbackTrialProduct = await product("rollback-trial", "core");
      const inactiveProduct = await product("inactive", "partner", false);

      const addChannel = async (productId: string, slug: string) => {
        const [channel] = await tx.insert(channels).values({ slug: `p3-${slug}-${suffix}`, displayName: slug, kind: "music", isPublished: true }).returning();
        await tx.insert(channelTracks).values({ channelId: channel.id, storageKey: `test/${suffix}/${slug}.mp3`, originalFilename: `${slug}.mp3`, sizeBytes: BigInt(1), sortOrder: 0 });
        await tx.insert(commercialProductChannels).values({ productId, channelId: channel.id });
        return channel.id;
      };
      const permanentChannel = await addChannel(permanentProduct.id, "permanent");
      const timedChannel = await addChannel(timedProduct.id, "timed");
      const trialChannel = await addChannel(trialProduct.id, "trial");

      const makeOffer = async (code: string, partnerId = partner.id, isActive = true) => {
        const [row] = await tx.insert(commercialOffers).values({ partnerId, code: `${code}-${suffix}`, name: code, isActive }).returning();
        return row;
      };
      const addGrant = async (offerId: string, productId: string, grantType: "partner_benefit" | "trial", durationDays: number | null) => {
        await tx.insert(commercialOfferGrants).values({ offerId, productId, grantType, durationDays });
      };
      const makeInvite = async (offerId: string, options: { maxClaims?: number | null; createdAt?: Date; expiresAt?: Date | null; revokedAt?: Date | null } = {}) => {
        const token = `opaque-${suffix}-${randomUUID()}`;
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const [invite] = await tx.insert(commercialPartnerInvites).values({
          offerId,
          tokenHash,
          maxClaims: options.maxClaims ?? null,
          expiresAt: options.expiresAt ?? null,
          revokedAt: options.revokedAt ?? null,
          ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        }).returning();
        return { token, invite };
      };
      const countClaims = async (inviteId: string) => (await tx.select().from(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, inviteId))).length;

      // Unlimited claim maps permanent/time-bounded Partner Benefits and a
      // 30-day Product trial into the existing entitlement tables.
      const standardOffer = await makeOffer("standard");
      await addGrant(standardOffer.id, permanentProduct.id, "partner_benefit", null);
      await addGrant(standardOffer.id, timedProduct.id, "partner_benefit", 10);
      await addGrant(standardOffer.id, trialProduct.id, "trial", 30);
      const standard = await makeInvite(standardOffer.id);
      const first = await claimPartnerInvite({ token: standard.token, locationId: locationA.id }, runner);
      assert.equal(first.status, "claimed");
      if (first.status !== "claimed") throw new Error("Expected initial claim result");
      assert.equal(first.benefits.length, 2);
      assert.equal(first.benefits.find((item) => item.productId === permanentProduct.id)?.endsAt, null);
      const timedBenefit = first.benefits.find((item) => item.productId === timedProduct.id);
      assert.equal(timedBenefit?.endsAt?.getTime(), timedBenefit!.startsAt.getTime() + 10 * DAY_MS);
      assert.deepEqual(first.trials, [{ productId: trialProduct.id, result: "created" }]);
      const dbInvite = await tx.select().from(commercialPartnerInvites).where(eq(commercialPartnerInvites.id, standard.invite.id));
      assert.equal(dbInvite[0]?.tokenHash, createHash("sha256").update(standard.token).digest("hex"));
      assert.equal("token" in dbInvite[0]!, false);

      const retry = await claimPartnerInvite({ token: standard.token, locationId: locationA.id }, runner);
      assert.equal(retry.status, "already_claimed");
      assert.equal(await countClaims(standard.invite.id), 1);
      assert.equal((await tx.select().from(commercialPartnerBenefits).where(eq(commercialPartnerBenefits.locationId, locationA.id))).length, 2);
      assert.equal((await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationA.id), eq(locationCoreTrials.productId, trialProduct.id)))).length, 1);

      // P5.3's trusted stored-hash path delegates to the same P3 claim engine.
      const hashClaim = await claimPartnerInviteByHash({ tokenHash: standard.invite.tokenHash, locationId: locationB.id }, runner);
      assert.equal(hashClaim.status, "claimed");
      if (hashClaim.status !== "claimed") throw new Error("Expected stored-hash claim result");
      assert.equal(hashClaim.benefits.length, 2);
      assert.deepEqual(hashClaim.trials, [{ productId: trialProduct.id, result: "created" }]);
      assert.equal(await countClaims(standard.invite.id), 2);
      await assert.rejects(claimPartnerInviteByHash({ tokenHash: "not-a-sha256", locationId: locationB.id }, runner),
        (error: unknown) => error instanceof PartnerInviteClaimError && error.code === "INVITE_UNAVAILABLE");

      const effective = new Map((await resolveEffectiveChannelAccess(locationA.id, new Date(), tx)).map((item) => [item.id, item]));
      assert(effective.get(permanentChannel)?.accessSources.includes("partner_benefit"));
      assert(effective.get(timedChannel)?.accessSources.includes("partner_benefit"));
      assert(effective.get(trialChannel)?.accessSources.includes("trial"));

      // Same-location retry is checked before max_claims, so it remains
      // idempotent after consuming a one-claim invite's only slot.
      const limitedProduct = await product("limited", "partner");
      const limitedOffer = await makeOffer("limited");
      await addGrant(limitedOffer.id, limitedProduct.id, "partner_benefit", null);
      const limited = await makeInvite(limitedOffer.id, { maxClaims: 1 });
      assert.equal((await claimPartnerInvite({ token: limited.token, locationId: locationA.id }, runner)).status, "claimed");
      assert.equal((await claimPartnerInvite({ token: limited.token, locationId: locationA.id }, runner)).status, "already_claimed");
      await expectDomainError(claimPartnerInvite({ token: limited.token, locationId: locationB.id }, runner), "MAX_CLAIMS_EXHAUSTED");
      assert.equal(await countClaims(limited.invite.id), 1);

      // Trial records are never reset: current active trial, previously used
      // trial, and resolver-valid paid subscription each produce explicit skips.
      const activeTrial = activeTrialProduct;
      const usedTrial = usedTrialProduct;
      const paidTrial = paidTrialProduct;
      await tx.insert(locationCoreTrials).values([
        { locationId: locationB.id, productId: activeTrial.id, status: "active", startsAt: past, endsAt: future },
        { locationId: locationB.id, productId: usedTrial.id, status: "expired", startsAt: past, endsAt: ended },
      ]);
      await tx.insert(locationSubscriptions).values({ locationId: locationB.id, productId: paidTrial.id, provider: providerCode, status: "active", startsAt: past, currentPeriodEndsAt: future });
      const skipOffer = await makeOffer("skip-trials");
      await addGrant(skipOffer.id, activeTrial.id, "trial", 30);
      await addGrant(skipOffer.id, usedTrial.id, "trial", 30);
      await addGrant(skipOffer.id, paidTrial.id, "trial", 30);
      const skipInvite = await makeInvite(skipOffer.id);
      const beforeActive = (await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationB.id), eq(locationCoreTrials.productId, activeTrial.id))))[0]!;
      const skipped = await claimPartnerInvite({ token: skipInvite.token, locationId: locationB.id }, runner);
      assert.equal(skipped.status, "claimed");
      if (skipped.status !== "claimed") throw new Error("Expected trial skip claim result");
      assert.deepEqual(new Map(skipped.trials.map((item) => [item.productId, item.result])), new Map([
        [activeTrial.id, "skipped_active"], [usedTrial.id, "skipped_already_used"], [paidTrial.id, "skipped_paid_access"],
      ]));
      const afterActive = (await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationB.id), eq(locationCoreTrials.productId, activeTrial.id))))[0]!;
      assert.equal(afterActive.id, beforeActive.id);
      assert.equal(afterActive.endsAt.getTime(), beforeActive.endsAt.getTime());
      assert.equal((await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationB.id), eq(locationCoreTrials.productId, usedTrial.id)))).length, 1);
      assert.equal((await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationB.id), eq(locationCoreTrials.productId, paidTrial.id)))).length, 0);

      // Invalid invite and configuration cases leave no claim or entitlement.
      const revokedOffer = await makeOffer("revoked");
      await addGrant(revokedOffer.id, permanentProduct.id, "partner_benefit", null);
      const revoked = await makeInvite(revokedOffer.id, { revokedAt: now });
      await expectDomainError(claimPartnerInvite({ token: revoked.token, locationId: locationB.id }, runner), "INVITE_UNAVAILABLE");
      const expiredCreatedAt = new Date(now.getTime() - 2 * DAY_MS);
      const expiredAt = new Date(now.getTime() - DAY_MS);
      const expired = await makeInvite(revokedOffer.id, { createdAt: expiredCreatedAt, expiresAt: expiredAt });
      assert(expired.invite.createdAt < expired.invite.expiresAt!, "expired invite fixture must satisfy created_at < expires_at");
      assert(expired.invite.expiresAt! < new Date(), "expired invite fixture must already be expired at claim time");
      const expiredBenefitCount = (await tx.select().from(commercialPartnerBenefits).where(and(
        eq(commercialPartnerBenefits.partnerId, partner.id),
        eq(commercialPartnerBenefits.productId, permanentProduct.id),
        eq(commercialPartnerBenefits.locationId, locationB.id),
      ))).length;
      await expectDomainError(claimPartnerInvite({ token: expired.token, locationId: locationB.id }, runner), "INVITE_UNAVAILABLE");
      assert.equal(await countClaims(expired.invite.id), 0);
      assert.equal((await tx.select().from(commercialPartnerBenefits).where(and(
        eq(commercialPartnerBenefits.partnerId, partner.id),
        eq(commercialPartnerBenefits.productId, permanentProduct.id),
        eq(commercialPartnerBenefits.locationId, locationB.id),
      ))).length, expiredBenefitCount);
      await expectDomainError(claimPartnerInvite({ token: `unknown-${suffix}`, locationId: locationB.id }, runner), "INVITE_UNAVAILABLE");
      await expectDomainError(claimPartnerInvite({ token: revoked.token, locationId: "not-a-uuid" }, runner), "LOCATION_UNAVAILABLE");

      const inactiveOffer = await makeOffer("inactive-offer", partner.id, false);
      await addGrant(inactiveOffer.id, permanentProduct.id, "partner_benefit", null);
      const inactiveOfferInvite = await makeInvite(inactiveOffer.id);
      await expectDomainError(claimPartnerInvite({ token: inactiveOfferInvite.token, locationId: locationB.id }, runner), "OFFER_INACTIVE");

      const inactivePartner = await tx.insert(commercialPartners).values({ code: `p3-inactive-partner-${suffix}`, name: "Inactive partner", isActive: false }).returning();
      const inactivePartnerOffer = await makeOffer("inactive-partner", inactivePartner[0]!.id);
      await addGrant(inactivePartnerOffer.id, permanentProduct.id, "partner_benefit", null);
      const inactivePartnerInvite = await makeInvite(inactivePartnerOffer.id);
      await expectDomainError(claimPartnerInvite({ token: inactivePartnerInvite.token, locationId: locationB.id }, runner), "PARTNER_INACTIVE");

      const inactiveProductOffer = await makeOffer("inactive-product");
      await tx.insert(commercialOfferGrants).values([
        { offerId: inactiveProductOffer.id, productId: rollbackBenefitProduct.id, grantType: "partner_benefit", durationDays: null },
        { offerId: inactiveProductOffer.id, productId: inactiveProduct.id, grantType: "partner_benefit", durationDays: null },
      ]);
      const inactiveProductInvite = await makeInvite(inactiveProductOffer.id);
      const benefitCountBeforeInactive = (await tx.select().from(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.locationId, locationB.id), eq(commercialPartnerBenefits.productId, rollbackBenefitProduct.id)))).length;
      await expectDomainError(claimPartnerInvite({ token: inactiveProductInvite.token, locationId: locationB.id }, runner), "PRODUCT_INACTIVE");
      assert.equal((await tx.select().from(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.locationId, locationB.id), eq(commercialPartnerBenefits.productId, rollbackBenefitProduct.id)))).length, benefitCountBeforeInactive);
      await expectDomainError(claimPartnerInvite({ token: inactiveProductInvite.token, locationId: randomUUID() }, runner), "LOCATION_UNAVAILABLE");
      for (const invite of [revoked, expired, inactiveOfferInvite, inactivePartnerInvite, inactiveProductInvite]) assert.equal(await countClaims(invite.invite.id), 0);

      const emptyOffer = await makeOffer("empty");
      const emptyOfferInvite = await makeInvite(emptyOffer.id);
      await expectDomainError(claimPartnerInvite({ token: emptyOfferInvite.token, locationId: locationB.id }, runner), "INVALID_OFFER_CONFIGURATION");
      assert.equal(await countClaims(emptyOfferInvite.invite.id), 0);

      // Inject a transient database failure on the second grant. The service
      // must roll back its earlier benefit insert and must not write a claim.
      const fnName = `p3_fail_${suffix.replaceAll("-", "")}`;
      const triggerName = `${fnName}_trigger`;
      const rollbackOffer = await makeOffer("forced-rollback");
      const [benefitGrantId, trialGrantId] = [randomUUID(), randomUUID()].sort();
      await tx.insert(commercialOfferGrants).values([
        { id: benefitGrantId, offerId: rollbackOffer.id, productId: rollbackBenefitProduct.id, grantType: "partner_benefit", durationDays: null },
        { id: trialGrantId, offerId: rollbackOffer.id, productId: rollbackTrialProduct.id, grantType: "trial", durationDays: 30 },
      ]);
      const rollbackInvite = await makeInvite(rollbackOffer.id);
      await tx.execute(sql.raw(`CREATE FUNCTION public.${fnName}() RETURNS trigger LANGUAGE plpgsql AS $p3$ BEGIN IF NEW.product_id = '${rollbackTrialProduct.id}'::uuid THEN RAISE EXCEPTION 'intentional P3 rollback test' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $p3$`));
      await tx.execute(sql.raw(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON public.location_core_trials FOR EACH ROW EXECUTE FUNCTION public.${fnName}()`));
      await assert.rejects(claimPartnerInvite({ token: rollbackInvite.token, locationId: locationB.id }, runner), (error: unknown) => getPostgresCode(error) === "P0001");
      assert.equal((await tx.select().from(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.locationId, locationB.id), eq(commercialPartnerBenefits.productId, rollbackBenefitProduct.id)))).length, 0);
      assert.equal((await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationB.id), eq(locationCoreTrials.productId, rollbackTrialProduct.id)))).length, 0);
      assert.equal(await countClaims(rollbackInvite.invite.id), 0);
      await tx.execute(sql.raw(`DROP TRIGGER ${triggerName} ON public.location_core_trials`));
      await tx.execute(sql.raw(`DROP FUNCTION public.${fnName}()`));

      // P3 effects are restricted to existing commercial benefit/trial and
      // invite audit tables; no channel-level grants are created.
      assert.equal((await tx.select().from(locationChannelGrants).where(eq(locationChannelGrants.locationId, locationA.id))).length, 0);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  await runConcurrentMaxClaimTest();
  console.info("Partner invite claim service PASS: plaintext and stored-hash entry points share grant mapping, idempotency, limits, inactive/expired states, trial skip rules, Effective Access integration, rollback atomicity, and PostgreSQL concurrency.");
  await v2Pool.end();
}

async function runConcurrentMaxClaimTest() {
  const suffix = randomUUID();
  let organizationId = "", locationAId = "", locationBId = "", partnerId = "", productId = "", offerId = "", inviteId = "";
  const token = `opaque-concurrency-${suffix}`;
  try {
    await v2Db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name: `p3-concurrency-${suffix}` }).returning(); organizationId = organization.id;
      const [a] = await tx.insert(locations).values({ organizationId, name: "Concurrent A", slug: `p3-concurrent-a-${suffix}`, timezone: "UTC" }).returning(); locationAId = a.id;
      const [b] = await tx.insert(locations).values({ organizationId, name: "Concurrent B", slug: `p3-concurrent-b-${suffix}`, timezone: "UTC" }).returning(); locationBId = b.id;
      const [partner] = await tx.insert(commercialPartners).values({ code: `p3-concurrent-${suffix}`, name: "Concurrent partner" }).returning(); partnerId = partner.id;
      const [product] = await tx.insert(commercialProducts).values({ code: `p3-concurrent-${suffix}`, name: "Concurrent product", kind: "partner" }).returning(); productId = product.id;
      const [offer] = await tx.insert(commercialOffers).values({ partnerId, code: "one-claim", name: "One claim" }).returning(); offerId = offer.id;
      await tx.insert(commercialOfferGrants).values({ offerId, productId, grantType: "partner_benefit", durationDays: null });
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const [invite] = await tx.insert(commercialPartnerInvites).values({ offerId, tokenHash, maxClaims: 1 }).returning(); inviteId = invite.id;
    });

    const attempts = await Promise.allSettled([
      claimPartnerInvite({ token, locationId: locationAId }),
      claimPartnerInvite({ token, locationId: locationBId }),
    ]);
    const successes = attempts.filter((attempt) => attempt.status === "fulfilled" && attempt.value.status === "claimed");
    const exhausted = attempts.filter((attempt) => attempt.status === "rejected" && attempt.reason instanceof PartnerInviteClaimError && attempt.reason.code === "MAX_CLAIMS_EXHAUSTED");
    assert.equal(successes.length, 1);
    assert.equal(exhausted.length, 1);
    const claims = await v2Db.select().from(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, inviteId));
    assert.equal(claims.length, 1);
  } finally {
    if (inviteId) {
      await v2Db.transaction(async (tx) => {
        await tx.delete(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, inviteId));
        if (locationAId) await tx.delete(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.partnerId, partnerId), eq(commercialPartnerBenefits.productId, productId), eq(commercialPartnerBenefits.locationId, locationAId)));
        if (locationBId) await tx.delete(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.partnerId, partnerId), eq(commercialPartnerBenefits.productId, productId), eq(commercialPartnerBenefits.locationId, locationBId)));
        await tx.delete(commercialPartnerInvites).where(eq(commercialPartnerInvites.id, inviteId));
        await tx.delete(commercialOfferGrants).where(eq(commercialOfferGrants.offerId, offerId));
        await tx.delete(commercialOffers).where(eq(commercialOffers.id, offerId));
        await tx.delete(commercialProducts).where(eq(commercialProducts.id, productId));
        await tx.delete(commercialPartners).where(eq(commercialPartners.id, partnerId));
        await tx.delete(locations).where(and(eq(locations.id, locationAId), eq(locations.organizationId, organizationId)));
        await tx.delete(locations).where(and(eq(locations.id, locationBId), eq(locations.organizationId, organizationId)));
        await tx.delete(organizations).where(eq(organizations.id, organizationId));
      });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
