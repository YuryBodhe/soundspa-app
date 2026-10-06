import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { v2Db, v2Pool } from "../../db/v2/client";
import { claimPartnerInvite, PartnerInviteClaimError } from "../../db/v2/services/partnerInviteClaims";
import {
  addPartnerOfferGrant,
  createPartnerInvite,
  createPartnerOffer,
  getPartnerInviteLifecycleStatus,
  listPartnerInvites,
  lockOfferConfiguration,
  PartnerOfferAdminError,
  removePartnerOfferGrant,
  revokePartnerInvite,
  type PartnerOfferAdminErrorCode,
} from "../../db/v2/services/partnerOfferAdmin";
import {
  commercialOfferGrants,
  commercialOffers,
  commercialPartnerBenefits,
  commercialPartnerInviteClaims,
  commercialPartnerInvites,
  commercialPartners,
  commercialProducts,
  locationCoreTrials,
  locations,
  organizations,
} from "../../db/v2/schema";

class Rollback extends Error {}
type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;

async function expectAdminError(operation: Promise<unknown>, code: PartnerOfferAdminErrorCode) {
  await assert.rejects(operation, (error: unknown) => error instanceof PartnerOfferAdminError && error.code === code);
}

async function expectClaimUnavailable(operation: Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => error instanceof PartnerInviteClaimError && error.code === "INVITE_UNAVAILABLE");
}

async function main() {
  await runRollbackCoverage();
  await runOfferInviteGrantConcurrency();
  await runRevokeClaimConcurrency();
  console.info("Partner Invite Admin integration PASS: secure one-time token, hash-only storage, limits/expiry, eligibility, lifecycle/counts, P4A grant locking, revoke preservation/idempotency, P3 claim rejection after revoke, transaction rollback, and PostgreSQL lock ordering.");
}

async function runRollbackCoverage() {
  let partnerId = "";
  let offerId = "";
  let benefitProductId = "";
  let trialProductId = "";
  let organizationId = "";
  let locationAId = "";
  let locationBId = "";
  const issuedInviteIds: string[] = [];

  await v2Db.transaction(async (tx) => {
    const suffix = randomUUID();
    const runner: TransactionRunner = <T>(operation: (inner: V2Transaction) => Promise<T>) => tx.transaction(operation);
    const [partner] = await tx.insert(commercialPartners).values({ code: `p4b-${suffix}`, name: "P4B test partner" }).returning(); partnerId = partner.id;
    const [benefitProduct] = await tx.insert(commercialProducts).values({ code: `p4b-benefit-${suffix}`, name: "P4B benefit", kind: "partner" }).returning(); benefitProductId = benefitProduct.id;
    const [trialProduct] = await tx.insert(commercialProducts).values({ code: `p4b-trial-${suffix}`, name: "P4B trial", kind: "core" }).returning(); trialProductId = trialProduct.id;
    const [inactiveProduct] = await tx.insert(commercialProducts).values({ code: `p4b-inactive-${suffix}`, name: "P4B inactive", kind: "partner", isActive: false }).returning();
    const [organization] = await tx.insert(organizations).values({ name: `p4b-org-${suffix}` }).returning(); organizationId = organization.id;
    const [locationA] = await tx.insert(locations).values({ organizationId, name: "P4B location A", slug: `p4b-a-${suffix}`, timezone: "UTC" }).returning(); locationAId = locationA.id;
    const [locationB] = await tx.insert(locations).values({ organizationId, name: "P4B location B", slug: `p4b-b-${suffix}`, timezone: "UTC" }).returning(); locationBId = locationB.id;

    const offer = await createPartnerOffer({ partnerId, code: "vip", name: "P4B test VIP" }, runner); offerId = offer.id;
    await addPartnerOfferGrant({ offerId, productId: benefitProductId, grantType: "partner_benefit", durationDays: null }, runner);
    await addPartnerOfferGrant({ offerId, productId: trialProductId, grantType: "trial", durationDays: 30 }, runner);

    for (const maxClaims of [undefined, 0, -1, 1.5, "2", 2_147_483_648]) {
      await expectAdminError(createPartnerInvite(offerId, { maxClaims, expiresAt: null }, runner), "INVALID_MAX_CLAIMS");
    }
    for (const expiresAt of [undefined, "bad-date", "2035-01-01T00:00:00", new Date(Date.now() - 1000), new Date()]) {
      await expectAdminError(createPartnerInvite(offerId, { maxClaims: null, expiresAt }, runner), "INVALID_EXPIRY");
    }

    const unlimited = await createPartnerInvite(offerId, { maxClaims: null, expiresAt: null }, runner);
    issuedInviteIds.push(unlimited.invite.id);
    assert.match(unlimited.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(unlimited.token, "base64url").byteLength, 32, "token encodes 256 random bits");
    const [stored] = await tx.select().from(commercialPartnerInvites).where(eq(commercialPartnerInvites.id, unlimited.invite.id));
    assert.equal(stored?.tokenHash, createHash("sha256").update(unlimited.token, "utf8").digest("hex"));
    assert.equal(JSON.stringify(stored).includes(unlimited.token), false);
    assert.equal("token" in (stored ?? {}), false);
    assert.equal(stored?.maxClaims, null);
    assert.equal(stored?.expiresAt, null);
    const listedWithoutPlaintext = await listPartnerInvites(offerId, new Date(), tx);
    const active = listedWithoutPlaintext.find((invite) => invite.id === unlimited.invite.id)!;
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.claimCount, 0);
    assert.equal("tokenHash" in active, false);
    assert.equal(JSON.stringify(active).includes(unlimited.token), false);

    const future = new Date(Date.now() + 7 * 86_400_000);
    const limited = await createPartnerInvite(offerId, { maxClaims: 3, expiresAt: future.toISOString() }, runner);
    issuedInviteIds.push(limited.invite.id);
    assert.equal(limited.invite.maxClaims, 3);
    assert(limited.invite.expiresAt && limited.invite.expiresAt > new Date());
    assert.equal((await listPartnerInvites(offerId, new Date(), tx)).find((invite) => invite.id === limited.invite.id)?.status, "ACTIVE");

    const revokedByService = await revokePartnerInvite(limited.invite.id, runner);
    assert(revokedByService.revokedAt instanceof Date);
    assert.equal((await revokePartnerInvite(limited.invite.id, runner)).revokedAt?.getTime(), revokedByService.revokedAt.getTime(), "revoke is idempotent");
    assert.equal((await listPartnerInvites(offerId, new Date(), tx)).find((invite) => invite.id === limited.invite.id)?.status, "REVOKED");

    const expiredAt = new Date(Date.now() - 86_400_000);
    const expiredCreatedAt = new Date(Date.now() - 2 * 86_400_000);
    const expiredTokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    const [expired] = await tx.insert(commercialPartnerInvites).values({ offerId, tokenHash: expiredTokenHash, createdAt: expiredCreatedAt, expiresAt: expiredAt }).returning({ id: commercialPartnerInvites.id });
    issuedInviteIds.push(expired.id);

    const exhaustedTokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    const [exhausted] = await tx.insert(commercialPartnerInvites).values({ offerId, tokenHash: exhaustedTokenHash, maxClaims: 1 }).returning({ id: commercialPartnerInvites.id });
    issuedInviteIds.push(exhausted.id);
    await tx.insert(commercialPartnerInviteClaims).values({ inviteId: exhausted.id, locationId: locationAId });
    const statuses = await listPartnerInvites(offerId, new Date(), tx);
    assert.equal(statuses.find((invite) => invite.id === expired.id)?.status, "EXPIRED");
    assert.equal(statuses.find((invite) => invite.id === exhausted.id)?.status, "EXHAUSTED");
    assert.equal(statuses.find((invite) => invite.id === exhausted.id)?.claimCount, 1);
    assert.equal(getPartnerInviteLifecycleStatus({ revokedAt: new Date(), expiresAt: expiredAt, maxClaims: 1, claimCount: 1 }), "REVOKED");

    // Issuance permanently locks P4A grant composition, including after revoke/expiry.
    await expectAdminError(addPartnerOfferGrant({ offerId, productId: randomUUID(), grantType: "trial", durationDays: 30 }, runner), "GRANTS_LOCKED");
    const [existingGrant] = await tx.select().from(commercialOfferGrants).where(eq(commercialOfferGrants.offerId, offerId));
    await expectAdminError(removePartnerOfferGrant(offerId, existingGrant!.id, runner), "GRANTS_LOCKED");

    // P3 applies existing grants transactionally; P4B revocation must not undo them.
    const claimed = await claimPartnerInvite({ token: unlimited.token, locationId: locationAId }, runner);
    assert.equal(claimed.status, "claimed");
    assert.equal((await listPartnerInvites(offerId, new Date(), tx)).find((invite) => invite.id === unlimited.invite.id)?.claimCount, 1);
    const beforeBenefitCount = (await tx.select().from(commercialPartnerBenefits).where(and(
      eq(commercialPartnerBenefits.partnerId, partnerId), eq(commercialPartnerBenefits.productId, benefitProductId), eq(commercialPartnerBenefits.locationId, locationAId),
    ))).length;
    const beforeTrialCount = (await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationAId), eq(locationCoreTrials.productId, trialProductId)))).length;
    await revokePartnerInvite(unlimited.invite.id, runner);
    assert.equal((await tx.select().from(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, unlimited.invite.id))).length, 1);
    assert.equal((await tx.select().from(commercialPartnerBenefits).where(and(
      eq(commercialPartnerBenefits.partnerId, partnerId), eq(commercialPartnerBenefits.productId, benefitProductId), eq(commercialPartnerBenefits.locationId, locationAId),
    ))).length, beforeBenefitCount);
    assert.equal((await tx.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationAId), eq(locationCoreTrials.productId, trialProductId)))).length, beforeTrialCount);
    await expectClaimUnavailable(claimPartnerInvite({ token: unlimited.token, locationId: locationBId }, runner));
    assert.equal((await tx.select().from(commercialPartnerInviteClaims).where(and(eq(commercialPartnerInviteClaims.inviteId, unlimited.invite.id), eq(commercialPartnerInviteClaims.locationId, locationBId)))).length, 0);

    // Eligibility gates are enforced before a row is created.
    const inactiveOffer = await createPartnerOffer({ partnerId, code: "inactive", name: "Inactive Offer" }, runner);
    await setOfferInactive(inactiveOffer.id, runner);
    await expectAdminError(createPartnerInvite(inactiveOffer.id, { maxClaims: null, expiresAt: null }, runner), "OFFER_INACTIVE");
    const [inactivePartner] = await tx.insert(commercialPartners).values({ code: `p4b-inactive-${suffix}`, name: "Inactive Partner", isActive: false }).returning();
    const inactivePartnerOffer = await createPartnerOffer({ partnerId: inactivePartner.id, code: "inactive-partner", name: "Inactive Partner Offer" }, runner);
    await expectAdminError(createPartnerInvite(inactivePartnerOffer.id, { maxClaims: null, expiresAt: null }, runner), "PARTNER_INACTIVE");
    const emptyOffer = await createPartnerOffer({ partnerId, code: "empty", name: "Empty Offer" }, runner);
    await expectAdminError(createPartnerInvite(emptyOffer.id, { maxClaims: null, expiresAt: null }, runner), "OFFER_HAS_NO_GRANTS");
    const inactiveProductOffer = await createPartnerOffer({ partnerId, code: "inactive-product", name: "Inactive Product Offer" }, runner);
    await addPartnerOfferGrant({ offerId: inactiveProductOffer.id, productId: inactiveProduct.id, grantType: "partner_benefit", durationDays: null }, runner);
    await expectAdminError(createPartnerInvite(inactiveProductOffer.id, { maxClaims: null, expiresAt: null }, runner), "PRODUCT_INACTIVE");

    throw new Rollback();
  }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });

  assert.equal((await v2Db.select().from(commercialPartners).where(eq(commercialPartners.id, partnerId))).length, 0, "partner and rollback fixture are gone");
  assert.equal((await v2Db.select().from(commercialOffers).where(eq(commercialOffers.id, offerId))).length, 0, "Offer fixture is gone");
  assert.equal((await v2Db.select().from(commercialProducts).where(eq(commercialProducts.id, benefitProductId))).length, 0);
  assert.equal((await v2Db.select().from(commercialProducts).where(eq(commercialProducts.id, trialProductId))).length, 0);
  assert.equal((await v2Db.select().from(organizations).where(eq(organizations.id, organizationId))).length, 0);
  assert(issuedInviteIds.length >= 4);
}

async function setOfferInactive(offerId: string, runner: TransactionRunner) {
  await runner(async (tx) => { await tx.update(commercialOffers).set({ isActive: false }).where(eq(commercialOffers.id, offerId)); });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForLockWait(applicationName: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await v2Db.execute(sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = ${applicationName}`);
    const row = (result.rows as { wait_event_type: string | null }[])[0];
    if (row?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Timed out waiting for PostgreSQL row-lock wait.");
}

async function runOfferInviteGrantConcurrency() {
  const suffix = randomUUID();
  let partnerId = ""; let productAId = ""; let productBId = ""; let offerId = "";
  const inviteIds: string[] = [];
  const releaseInvite = deferred();
  let inviteCreation: Promise<Awaited<ReturnType<typeof createPartnerInvite>>> | null = null;
  let grantMutation: Promise<unknown> | null = null;
  try {
    const [partner] = await v2Db.insert(commercialPartners).values({ code: `p4b-race-${suffix}`, name: "P4B race partner" }).returning(); partnerId = partner.id;
    const [productA] = await v2Db.insert(commercialProducts).values({ code: `p4b-race-a-${suffix}`, name: "P4B race product A", kind: "partner" }).returning(); productAId = productA.id;
    const [productB] = await v2Db.insert(commercialProducts).values({ code: `p4b-race-b-${suffix}`, name: "P4B race product B", kind: "core" }).returning(); productBId = productB.id;
    const offer = await createPartnerOffer({ partnerId, code: "race", name: "Race Offer" }); offerId = offer.id;
    await addPartnerOfferGrant({ offerId, productId: productAId, grantType: "partner_benefit", durationDays: null });

    const inviteRunner: TransactionRunner = (operation) => v2Db.transaction(async (tx) => {
      await lockOfferConfiguration(tx, offerId);
      inviteLockSignal.resolve();
      await releaseInvite.promise;
      return operation(tx);
    });
    const inviteLockSignal = deferred();
    inviteCreation = createPartnerInvite(offerId, { maxClaims: null, expiresAt: null }, inviteRunner);
    await Promise.race([inviteLockSignal.promise, inviteCreation.then(() => { throw new Error("Invite transaction completed before the expected lock signal."); })]);

    const applicationName = `p4b-grant-${suffix.slice(0, 24)}`;
    const taggedRunner: TransactionRunner = (operation) => v2Db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('application_name', ${applicationName}, true)`);
      return operation(tx);
    });
    grantMutation = addPartnerOfferGrant({ offerId, productId: productBId, grantType: "trial", durationDays: 30 }, taggedRunner);
    await waitForLockWait(applicationName);
    releaseInvite.resolve();
    const [inviteResult, grantResult] = await Promise.allSettled([inviteCreation, grantMutation]);
    assert.equal(inviteResult.status, "fulfilled");
    if (inviteResult.status === "fulfilled") inviteIds.push(inviteResult.value.invite.id);
    assert.equal(grantResult.status, "rejected");
    if (grantResult.status === "rejected") assert(grantResult.reason instanceof PartnerOfferAdminError && grantResult.reason.code === "GRANTS_LOCKED");
  } finally {
    releaseInvite.resolve();
    if (inviteCreation) await inviteCreation.catch(() => undefined);
    if (grantMutation) await grantMutation.catch(() => undefined);
    if (offerId || productAId || productBId || partnerId) {
      await v2Db.transaction(async (tx) => {
        for (const inviteId of inviteIds) await tx.delete(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, inviteId));
        if (offerId) await tx.delete(commercialPartnerInvites).where(eq(commercialPartnerInvites.offerId, offerId));
        if (offerId) await tx.delete(commercialOfferGrants).where(eq(commercialOfferGrants.offerId, offerId));
        if (offerId) await tx.delete(commercialOffers).where(eq(commercialOffers.id, offerId));
        if (productAId) await tx.delete(commercialProducts).where(eq(commercialProducts.id, productAId));
        if (productBId) await tx.delete(commercialProducts).where(eq(commercialProducts.id, productBId));
        if (partnerId) await tx.delete(commercialPartners).where(eq(commercialPartners.id, partnerId));
      });
    }
  }
}

async function runRevokeClaimConcurrency() {
  const suffix = randomUUID();
  let partnerId = ""; let productBenefitId = ""; let productTrialId = ""; let offerId = ""; let inviteId = "";
  let organizationId = ""; let locationAId = ""; let locationBId = "";
  let token = "";
  const releaseClaim = deferred();
  let claim: Promise<Awaited<ReturnType<typeof claimPartnerInvite>>> | null = null;
  let revocation: Promise<unknown> | null = null;
  try {
    const [partner] = await v2Db.insert(commercialPartners).values({ code: `p4b-revoke-${suffix}`, name: "P4B revoke partner" }).returning(); partnerId = partner.id;
    const [benefit] = await v2Db.insert(commercialProducts).values({ code: `p4b-revoke-benefit-${suffix}`, name: "P4B revoke benefit", kind: "partner" }).returning(); productBenefitId = benefit.id;
    const [trial] = await v2Db.insert(commercialProducts).values({ code: `p4b-revoke-trial-${suffix}`, name: "P4B revoke trial", kind: "core" }).returning(); productTrialId = trial.id;
    const [organization] = await v2Db.insert(organizations).values({ name: `p4b-revoke-org-${suffix}` }).returning(); organizationId = organization.id;
    const [locationA] = await v2Db.insert(locations).values({ organizationId, name: "P4B revoke location A", slug: `p4b-revoke-a-${suffix}`, timezone: "UTC" }).returning(); locationAId = locationA.id;
    const [locationB] = await v2Db.insert(locations).values({ organizationId, name: "P4B revoke location B", slug: `p4b-revoke-b-${suffix}`, timezone: "UTC" }).returning(); locationBId = locationB.id;
    const offer = await createPartnerOffer({ partnerId, code: "revoke-race", name: "Revoke Race Offer" }); offerId = offer.id;
    await addPartnerOfferGrant({ offerId, productId: productBenefitId, grantType: "partner_benefit", durationDays: null });
    await addPartnerOfferGrant({ offerId, productId: productTrialId, grantType: "trial", durationDays: 30 });
    const created = await createPartnerInvite(offerId, { maxClaims: null, expiresAt: null }); inviteId = created.invite.id; token = created.token;

    const claimRunner: TransactionRunner = (operation) => v2Db.transaction(async (tx) => {
      const result = await operation(tx);
      claimOperationSignal.resolve();
      await releaseClaim.promise;
      return result;
    });
    const claimOperationSignal = deferred();
    claim = claimPartnerInvite({ token, locationId: locationAId }, claimRunner);
    await Promise.race([claimOperationSignal.promise, claim.then(() => { throw new Error("Claim transaction completed before the expected lock signal."); })]);

    const applicationName = `p4b-revoke-${suffix.slice(0, 24)}`;
    const taggedRunner: TransactionRunner = (operation) => v2Db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('application_name', ${applicationName}, true)`);
      return operation(tx);
    });
    revocation = revokePartnerInvite(inviteId, taggedRunner);
    await waitForLockWait(applicationName);
    releaseClaim.resolve();
    const [claimResult] = await Promise.all([claim, revocation]);
    assert.equal(claimResult.status, "claimed");
    const [storedInvite] = await v2Db.select().from(commercialPartnerInvites).where(eq(commercialPartnerInvites.id, inviteId));
    assert(storedInvite?.revokedAt instanceof Date);
    assert.equal((await v2Db.select().from(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, inviteId))).length, 1);
    assert.equal((await v2Db.select().from(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.partnerId, partnerId), eq(commercialPartnerBenefits.productId, productBenefitId), eq(commercialPartnerBenefits.locationId, locationAId)))).length, 1);
    assert.equal((await v2Db.select().from(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationAId), eq(locationCoreTrials.productId, productTrialId)))).length, 1);
    await expectClaimUnavailable(claimPartnerInvite({ token, locationId: locationBId }));
    assert.equal((await v2Db.select().from(commercialPartnerInviteClaims).where(and(eq(commercialPartnerInviteClaims.inviteId, inviteId), eq(commercialPartnerInviteClaims.locationId, locationBId)))).length, 0);
  } finally {
    releaseClaim.resolve();
    if (claim) await claim.catch(() => undefined);
    if (revocation) await revocation.catch(() => undefined);
    if (inviteId || offerId || productBenefitId || productTrialId || partnerId || locationAId || locationBId || organizationId) {
      await v2Db.transaction(async (tx) => {
        if (inviteId) await tx.delete(commercialPartnerInviteClaims).where(eq(commercialPartnerInviteClaims.inviteId, inviteId));
        if (partnerId && productBenefitId) await tx.delete(commercialPartnerBenefits).where(and(eq(commercialPartnerBenefits.partnerId, partnerId), eq(commercialPartnerBenefits.productId, productBenefitId)));
        if (locationAId && productTrialId) await tx.delete(locationCoreTrials).where(and(eq(locationCoreTrials.locationId, locationAId), eq(locationCoreTrials.productId, productTrialId)));
        if (inviteId) await tx.delete(commercialPartnerInvites).where(eq(commercialPartnerInvites.id, inviteId));
        if (offerId) await tx.delete(commercialOfferGrants).where(eq(commercialOfferGrants.offerId, offerId));
        if (offerId) await tx.delete(commercialOffers).where(eq(commercialOffers.id, offerId));
        if (productBenefitId) await tx.delete(commercialProducts).where(eq(commercialProducts.id, productBenefitId));
        if (productTrialId) await tx.delete(commercialProducts).where(eq(commercialProducts.id, productTrialId));
        if (partnerId) await tx.delete(commercialPartners).where(eq(commercialPartners.id, partnerId));
        if (locationAId) await tx.delete(locations).where(eq(locations.id, locationAId));
        if (locationBId) await tx.delete(locations).where(eq(locations.id, locationBId));
        if (organizationId) await tx.delete(organizations).where(eq(organizations.id, organizationId));
      });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await v2Pool.end(); });
