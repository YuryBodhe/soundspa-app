import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import {
  addPartnerOfferGrant,
  createPartnerOffer,
  PartnerOfferAdminError,
  removePartnerOfferGrant,
  setPartnerOfferActive,
  type PartnerOfferAdminErrorCode,
} from "../../db/v2/services/partnerOfferAdmin";
import { commercialOfferGrants, commercialOffers, commercialPartnerInvites, commercialPartners, commercialProducts } from "../../db/v2/schema";

class Rollback extends Error {}
type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];

async function expectDomainError(operation: Promise<unknown>, code: PartnerOfferAdminErrorCode) {
  await assert.rejects(operation, (error: unknown) => error instanceof PartnerOfferAdminError && error.code === code);
}

async function main() {
  let partnerId = "";
  let offerId = "";
  let benefitProductId = "";
  let trialProductId = "";
  await v2Db.transaction(async (tx) => {
    const suffix = randomUUID();
    const runner = <T>(operation: (inner: V2Transaction) => Promise<T>) => tx.transaction(operation);
    const [partner] = await tx.insert(commercialPartners).values({ code: `p4a-${suffix}`, name: "P4A test partner" }).returning();
    partnerId = partner.id;
    const [benefitProduct] = await tx.insert(commercialProducts).values({ code: `p4a-benefit-${suffix}`, name: "P4A benefit", kind: "partner" }).returning();
    benefitProductId = benefitProduct.id;
    const [trialProduct] = await tx.insert(commercialProducts).values({ code: `p4a-trial-${suffix}`, name: "P4A trial", kind: "core" }).returning();
    trialProductId = trialProduct.id;

    const offer = await createPartnerOffer({ partnerId: partner.id, code: "vip", name: "VIP Offer" }, runner);
    offerId = offer.id;
    assert.equal(offer.partnerId, partner.id);
    assert.equal(offer.isActive, true);
    await expectDomainError(createPartnerOffer({ partnerId: partner.id, code: "vip", name: "Duplicate" }, runner), "OFFER_CODE_EXISTS");
    assert.equal((await setPartnerOfferActive(offer.id, false, runner)).isActive, false);
    assert.equal((await setPartnerOfferActive(offer.id, true, runner)).isActive, true);

    const permanent = await addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null }, runner);
    const timed = await addPartnerOfferGrant({ offerId: offer.id, productId: trialProduct.id, grantType: "partner_benefit", durationDays: 14 }, runner);
    const trial = await addPartnerOfferGrant({ offerId: offer.id, productId: trialProduct.id, grantType: "trial", durationDays: 30 }, runner);
    assert.equal(permanent.durationDays, null);
    assert.equal(timed.durationDays, 14);
    assert.equal(trial.durationDays, 30);
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "trial", durationDays: 0 }, runner), "INVALID_INPUT");
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "trial", durationDays: null }, runner), "INVALID_INPUT");
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: -1 }, runner), "INVALID_INPUT");
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: 2_147_483_648 }, runner), "INVALID_INPUT");
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "unknown", durationDays: null }, runner), "INVALID_INPUT");
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: randomUUID(), grantType: "partner_benefit", durationDays: null }, runner), "PRODUCT_NOT_FOUND");
    await expectDomainError(addPartnerOfferGrant({ offerId: offer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null }, runner), "GRANT_ALREADY_EXISTS");
    assert.equal((await removePartnerOfferGrant(offer.id, timed.id, runner)).id, timed.id);
    assert.equal((await tx.select().from(commercialOfferGrants).where(eq(commercialOfferGrants.id, timed.id))).length, 0);

    // Any Invite issuance permanently locks composition, regardless of state.
    const lockedOffer = await createPartnerOffer({ partnerId: partner.id, code: "locked", name: "Locked Offer" }, runner);
    const lockedGrant = await addPartnerOfferGrant({ offerId: lockedOffer.id, productId: benefitProduct.id, grantType: "partner_benefit", durationDays: null }, runner);
    const insertInvite = async (offerId: string, state: { createdAt?: Date; expiresAt?: Date | null; revokedAt?: Date | null } = {}) => {
      const token = randomUUID();
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const [invite] = await tx.insert(commercialPartnerInvites).values({ offerId, tokenHash, ...state }).returning();
      return invite;
    };
    await insertInvite(lockedOffer.id);
    await expectDomainError(addPartnerOfferGrant({ offerId: lockedOffer.id, productId: trialProduct.id, grantType: "trial", durationDays: 30 }, runner), "GRANTS_LOCKED");
    await expectDomainError(removePartnerOfferGrant(lockedOffer.id, lockedGrant.id, runner), "GRANTS_LOCKED");

    const revokedOffer = await createPartnerOffer({ partnerId: partner.id, code: "revoked", name: "Revoked Invite Offer" }, runner);
    await insertInvite(revokedOffer.id, { revokedAt: new Date() });
    await expectDomainError(addPartnerOfferGrant({ offerId: revokedOffer.id, productId: trialProduct.id, grantType: "trial", durationDays: 30 }, runner), "GRANTS_LOCKED");

    const expiredOffer = await createPartnerOffer({ partnerId: partner.id, code: "expired", name: "Expired Invite Offer" }, runner);
    const now = Date.now();
    await insertInvite(expiredOffer.id, { createdAt: new Date(now - 2 * 86_400_000), expiresAt: new Date(now - 86_400_000) });
    await expectDomainError(addPartnerOfferGrant({ offerId: expiredOffer.id, productId: trialProduct.id, grantType: "trial", durationDays: 30 }, runner), "GRANTS_LOCKED");

    // The outer rollback is the cleanup path for every fixture above.
    throw new Rollback();
  }).catch((error: unknown) => {
    if (!(error instanceof Rollback)) throw error;
  });

  assert.equal((await v2Db.select().from(commercialPartners).where(eq(commercialPartners.id, partnerId))).length, 0, "partner fixture rolled back");
  assert.equal((await v2Db.select().from(commercialOffers).where(eq(commercialOffers.id, offerId))).length, 0, "offer fixture rolled back");
  assert.equal((await v2Db.select().from(commercialProducts).where(eq(commercialProducts.id, benefitProductId))).length, 0, "benefit Product fixture rolled back");
  assert.equal((await v2Db.select().from(commercialProducts).where(eq(commercialProducts.id, trialProductId))).length, 0, "trial Product fixture rolled back");

  console.info("Partner Offer Admin integration PASS: offer creation/uniqueness/state, valid benefit/trial grants, invalid and duplicate grants, pre-invite removal, permanent grant lock after active/revoked/expired Invite issuance, and outer transaction rollback.");
  await v2Pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
