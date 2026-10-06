import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialOfferGrants,
  commercialOffers,
  commercialPartnerInviteClaims,
  commercialPartnerInvites,
  commercialPartners,
  commercialProducts,
} from "../schema";
import { getPartnerInviteLifecycleStatus, PartnerOfferAdminError, requiredOfferText, validatePartnerInviteOptions, validatePartnerOfferGrant } from "./partnerOfferAdminValidation";
export { getPartnerInviteLifecycleStatus, PartnerOfferAdminError, type PartnerInviteLifecycleStatus, type PartnerOfferAdminErrorCode } from "./partnerOfferAdminValidation";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
const defaultTransaction: TransactionRunner = (operation) => v2Db.transaction(operation);

function postgresCode(error: unknown): string | undefined {
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

/**
 * Shared concurrency boundary for grant edits and future Invite issuance.
 * P4B must acquire this Offer row lock before inserting an Invite.
 */
export async function lockOfferConfiguration(tx: V2Transaction, offerId: string) {
  const [offer] = await tx.select({ id: commercialOffers.id, partnerId: commercialOffers.partnerId, isActive: commercialOffers.isActive }).from(commercialOffers)
    .where(eq(commercialOffers.id, offerId)).for("update");
  if (!offer) throw new PartnerOfferAdminError("OFFER_NOT_FOUND");
  return offer;
}

export async function createPartnerInvite(
  offerId: string,
  input: { maxClaims: unknown; expiresAt: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  const options = validatePartnerInviteOptions(input);
  return runInTransaction(async (tx) => {
    const offer = await lockOfferConfiguration(tx, offerId);
    if (!offer.isActive) throw new PartnerOfferAdminError("OFFER_INACTIVE");
    const [partner] = await tx.select({ id: commercialPartners.id, isActive: commercialPartners.isActive }).from(commercialPartners)
      .where(eq(commercialPartners.id, offer.partnerId)).for("share");
    if (!partner) throw new PartnerOfferAdminError("PARTNER_NOT_FOUND");
    if (!partner.isActive) throw new PartnerOfferAdminError("PARTNER_INACTIVE");

    const grants = await tx.select({ productActive: commercialProducts.isActive }).from(commercialOfferGrants)
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialOfferGrants.productId))
      .where(eq(commercialOfferGrants.offerId, offerId));
    if (!grants.length) throw new PartnerOfferAdminError("OFFER_HAS_NO_GRANTS");
    if (grants.some((grant) => !grant.productActive)) throw new PartnerOfferAdminError("PRODUCT_INACTIVE");

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const createdAt = new Date();
    if (options.expiresAt && options.expiresAt <= createdAt) throw new PartnerOfferAdminError("INVALID_EXPIRY");
    const [invite] = await tx.insert(commercialPartnerInvites).values({
      id: randomUUID(), offerId, tokenHash, maxClaims: options.maxClaims, expiresAt: options.expiresAt, createdAt,
    }).returning({ id: commercialPartnerInvites.id, offerId: commercialPartnerInvites.offerId, expiresAt: commercialPartnerInvites.expiresAt, maxClaims: commercialPartnerInvites.maxClaims, revokedAt: commercialPartnerInvites.revokedAt, createdAt: commercialPartnerInvites.createdAt });
    // This is the only operation that returns plaintext. The database row and
    // every listing projection contain only the SHA-256 token hash.
    return { token, invite };
  });
}

export async function listPartnerInvites(offerId: string, now = new Date(), db: Pick<typeof v2Db, "select"> = v2Db) {
  const rows = await db.select({
    invite: {
      id: commercialPartnerInvites.id,
      offerId: commercialPartnerInvites.offerId,
      expiresAt: commercialPartnerInvites.expiresAt,
      maxClaims: commercialPartnerInvites.maxClaims,
      revokedAt: commercialPartnerInvites.revokedAt,
      createdAt: commercialPartnerInvites.createdAt,
    },
    claimCount: count(commercialPartnerInviteClaims.id),
  }).from(commercialPartnerInvites)
    .leftJoin(commercialPartnerInviteClaims, eq(commercialPartnerInviteClaims.inviteId, commercialPartnerInvites.id))
    .where(eq(commercialPartnerInvites.offerId, offerId))
    .groupBy(commercialPartnerInvites.id)
    .orderBy(asc(commercialPartnerInvites.createdAt), asc(commercialPartnerInvites.id));
  return rows.map(({ invite, claimCount }) => {
    const claims = Number(claimCount);
    return { ...invite, claimCount: claims, status: getPartnerInviteLifecycleStatus({ ...invite, claimCount: claims }, now) };
  });
}

export async function revokePartnerInvite(
  inviteId: string,
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  return runInTransaction(async (tx) => {
    const [invite] = await tx.select({ id: commercialPartnerInvites.id, revokedAt: commercialPartnerInvites.revokedAt })
      .from(commercialPartnerInvites).where(eq(commercialPartnerInvites.id, inviteId)).for("update");
    if (!invite) throw new PartnerOfferAdminError("INVITE_NOT_FOUND");
    if (invite.revokedAt) return invite;
    const [revoked] = await tx.update(commercialPartnerInvites).set({ revokedAt: new Date() })
      .where(eq(commercialPartnerInvites.id, inviteId))
      .returning({ id: commercialPartnerInvites.id, revokedAt: commercialPartnerInvites.revokedAt });
    return revoked;
  });
}

async function assertNoInvites(tx: V2Transaction, offerId: string) {
  const [invite] = await tx.select({ id: commercialPartnerInvites.id }).from(commercialPartnerInvites)
    .where(eq(commercialPartnerInvites.offerId, offerId)).limit(1);
  if (invite) throw new PartnerOfferAdminError("GRANTS_LOCKED");
}

export async function listPartnerOffers() {
  const [partners, offerRows, grantRows] = await Promise.all([
    v2Db.select().from(commercialPartners).orderBy(asc(commercialPartners.name), asc(commercialPartners.id)),
    v2Db.select({ offer: commercialOffers, partner: commercialPartners, inviteCount: count(commercialPartnerInvites.id) })
      .from(commercialOffers)
      .innerJoin(commercialPartners, eq(commercialPartners.id, commercialOffers.partnerId))
      .leftJoin(commercialPartnerInvites, eq(commercialPartnerInvites.offerId, commercialOffers.id))
      .groupBy(commercialOffers.id, commercialPartners.id)
      .orderBy(asc(commercialOffers.name), asc(commercialOffers.id)),
    v2Db.select({ grant: commercialOfferGrants, product: commercialProducts })
      .from(commercialOfferGrants)
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialOfferGrants.productId))
      .orderBy(asc(commercialProducts.name), asc(commercialOfferGrants.id)),
  ]);
  const grantsByOffer = new Map<string, typeof grantRows>();
  for (const row of grantRows) grantsByOffer.set(row.grant.offerId, [...(grantsByOffer.get(row.grant.offerId) ?? []), row]);
  const offersByPartner = new Map<string, typeof offerRows>();
  for (const row of offerRows) offersByPartner.set(row.partner.id, [...(offersByPartner.get(row.partner.id) ?? []), row]);
  const products = await v2Db.select().from(commercialProducts).orderBy(asc(commercialProducts.name), asc(commercialProducts.id));
  return {
    partners: partners.map((partner) => ({
      partner,
      offers: (offersByPartner.get(partner.id) ?? []).map((row) => ({
        ...row.offer,
        inviteCount: Number(row.inviteCount),
        grantsLocked: Number(row.inviteCount) > 0,
        grants: grantsByOffer.get(row.offer.id) ?? [],
      })),
    })),
    products,
  };
}

export async function createPartnerOffer(
  input: { partnerId: unknown; code: unknown; name: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  const partnerId = requiredOfferText(input.partnerId);
  const code = requiredOfferText(input.code);
  const name = requiredOfferText(input.name);
  return runInTransaction(async (tx) => {
    const [partner] = await tx.select({ id: commercialPartners.id }).from(commercialPartners)
      .where(eq(commercialPartners.id, partnerId));
    if (!partner) throw new PartnerOfferAdminError("PARTNER_NOT_FOUND");
    try {
      const [offer] = await tx.insert(commercialOffers).values({ id: randomUUID(), partnerId, code, name, isActive: true }).returning();
      return offer;
    } catch (error) {
      if (postgresCode(error) === "23505") throw new PartnerOfferAdminError("OFFER_CODE_EXISTS");
      throw error;
    }
  });
}

export async function setPartnerOfferActive(
  offerId: string,
  isActive: boolean,
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  if (typeof isActive !== "boolean") throw new PartnerOfferAdminError("INVALID_INPUT");
  return runInTransaction(async (tx) => {
    const [offer] = await tx.update(commercialOffers).set({ isActive, updatedAt: new Date() })
      .where(eq(commercialOffers.id, offerId)).returning();
    if (!offer) throw new PartnerOfferAdminError("OFFER_NOT_FOUND");
    return offer;
  });
}

export async function addPartnerOfferGrant(
  input: { offerId: string; productId: unknown; grantType: unknown; durationDays: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  const { offerId } = input;
  const { productId, grantType, durationDays } = validatePartnerOfferGrant(input);

  return runInTransaction(async (tx) => {
    await lockOfferConfiguration(tx, offerId);
    await assertNoInvites(tx, offerId);
    const [product] = await tx.select({ id: commercialProducts.id }).from(commercialProducts)
      .where(eq(commercialProducts.id, productId));
    if (!product) throw new PartnerOfferAdminError("PRODUCT_NOT_FOUND");
    try {
      const [grant] = await tx.insert(commercialOfferGrants).values({
        id: randomUUID(), offerId, productId, grantType, durationDays,
      }).returning();
      return grant;
    } catch (error) {
      if (postgresCode(error) === "23505") throw new PartnerOfferAdminError("GRANT_ALREADY_EXISTS");
      throw error;
    }
  });
}

export async function removePartnerOfferGrant(
  offerId: string,
  grantId: string,
  runInTransaction: TransactionRunner = defaultTransaction,
) {
  return runInTransaction(async (tx) => {
    await lockOfferConfiguration(tx, offerId);
    await assertNoInvites(tx, offerId);
    const [grant] = await tx.delete(commercialOfferGrants)
      .where(and(eq(commercialOfferGrants.offerId, offerId), eq(commercialOfferGrants.id, grantId))).returning();
    if (!grant) throw new PartnerOfferAdminError("OFFER_NOT_FOUND");
    return grant;
  });
}
