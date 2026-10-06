import { createHash } from "node:crypto";
import { and, asc, count, eq, gt, isNull, lte, or } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialOfferGrants,
  commercialOffers,
  commercialPartnerBenefits,
  commercialPartnerInviteClaims,
  commercialPartnerInvites,
  commercialPartners,
  commercialProducts,
  locationCoreTrials,
  locationSubscriptions,
  locations,
  organizations,
} from "../schema";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;

export type PartnerInviteClaimErrorCode =
  | "INVITE_UNAVAILABLE"
  | "LOCATION_UNAVAILABLE"
  | "OFFER_INACTIVE"
  | "PARTNER_INACTIVE"
  | "PRODUCT_INACTIVE"
  | "MAX_CLAIMS_EXHAUSTED"
  | "INVALID_OFFER_CONFIGURATION";

export class PartnerInviteClaimError extends Error {
  constructor(readonly code: PartnerInviteClaimErrorCode) {
    super(code);
    this.name = "PartnerInviteClaimError";
  }
}

export type PartnerInviteClaimResult =
  | { status: "already_claimed"; benefits: []; trials: [] }
  | {
      status: "claimed";
      benefits: { productId: string; startsAt: Date; endsAt: Date | null }[];
      trials: { productId: string; result: "created" | "skipped_active" | "skipped_already_used" | "skipped_paid_access" }[];
    };

export type ClaimPartnerInviteInput = { token: string; locationId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Claims a hashed invite and applies its declarative grants in one transaction.
 * The optional runner is an internal test seam for wrapping the whole operation
 * in an outer rollback-only transaction; production callers should omit it.
 */
export async function claimPartnerInvite(
  input: ClaimPartnerInviteInput,
  runInTransaction: TransactionRunner = (operation) => v2Db.transaction(operation),
): Promise<PartnerInviteClaimResult> {
  if (!input.token) throw new PartnerInviteClaimError("INVITE_UNAVAILABLE");
  if (!uuidPattern.test(input.locationId)) throw new PartnerInviteClaimError("LOCATION_UNAVAILABLE");
  const tokenHash = createHash("sha256").update(input.token, "utf8").digest("hex");

  return runInTransaction(async (tx) => {
    const [resolved] = await tx.select({
      invite: commercialPartnerInvites,
      offer: commercialOffers,
      partner: commercialPartners,
    }).from(commercialPartnerInvites)
      .innerJoin(commercialOffers, eq(commercialOffers.id, commercialPartnerInvites.offerId))
      .innerJoin(commercialPartners, eq(commercialPartners.id, commercialOffers.partnerId))
      .where(eq(commercialPartnerInvites.tokenHash, tokenHash))
      // Serializes all claim attempts for this invite, including max-claim checks.
      .for("update", { of: [commercialPartnerInvites, commercialOffers, commercialPartners] });

    // Unknown, revoked, and expired credentials share one domain error so a
    // future public route can avoid revealing invite state to token guessers.
    if (!resolved) throw new PartnerInviteClaimError("INVITE_UNAVAILABLE");

    const [priorClaim] = await tx.select({ id: commercialPartnerInviteClaims.id }).from(commercialPartnerInviteClaims)
      .where(and(eq(commercialPartnerInviteClaims.inviteId, resolved.invite.id), eq(commercialPartnerInviteClaims.locationId, input.locationId)));
    if (priorClaim) return { status: "already_claimed", benefits: [], trials: [] };

    const now = new Date();
    if (resolved.invite.revokedAt || (resolved.invite.expiresAt && resolved.invite.expiresAt <= now)) {
      throw new PartnerInviteClaimError("INVITE_UNAVAILABLE");
    }
    if (!resolved.offer.isActive) throw new PartnerInviteClaimError("OFFER_INACTIVE");
    if (!resolved.partner.isActive) throw new PartnerInviteClaimError("PARTNER_INACTIVE");

    const [location] = await tx.select({ id: locations.id }).from(locations)
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(eq(locations.id, input.locationId), isNull(locations.archivedAt), isNull(organizations.archivedAt)))
      .for("share", { of: [locations, organizations] });
    if (!location) throw new PartnerInviteClaimError("LOCATION_UNAVAILABLE");

    const grants = await tx.select({ grant: commercialOfferGrants, product: commercialProducts })
      .from(commercialOfferGrants)
      .innerJoin(commercialProducts, eq(commercialProducts.id, commercialOfferGrants.productId))
      .where(eq(commercialOfferGrants.offerId, resolved.offer.id))
      .orderBy(asc(commercialOfferGrants.id))
      .for("share", { of: [commercialOfferGrants, commercialProducts] });
    if (grants.length === 0) throw new PartnerInviteClaimError("INVALID_OFFER_CONFIGURATION");

    for (const { grant, product } of grants) {
      if (!product.isActive) throw new PartnerInviteClaimError("PRODUCT_INACTIVE");
      if (grant.grantType === "trial") {
        if (!Number.isInteger(grant.durationDays) || (grant.durationDays ?? 0) <= 0) {
          throw new PartnerInviteClaimError("INVALID_OFFER_CONFIGURATION");
        }
      } else if (grant.grantType === "partner_benefit") {
        if (grant.durationDays !== null && (!Number.isInteger(grant.durationDays) || grant.durationDays <= 0)) {
          throw new PartnerInviteClaimError("INVALID_OFFER_CONFIGURATION");
        }
      } else {
        throw new PartnerInviteClaimError("INVALID_OFFER_CONFIGURATION");
      }
      if (grant.durationDays !== null && !Number.isFinite(new Date(now.getTime() + grant.durationDays * DAY_MS).getTime())) {
        throw new PartnerInviteClaimError("INVALID_OFFER_CONFIGURATION");
      }
    }

    if (resolved.invite.maxClaims !== null) {
      const [claimed] = await tx.select({ total: count() }).from(commercialPartnerInviteClaims)
        .where(eq(commercialPartnerInviteClaims.inviteId, resolved.invite.id));
      if (claimed.total >= resolved.invite.maxClaims) throw new PartnerInviteClaimError("MAX_CLAIMS_EXHAUSTED");
    }

    const benefits: Extract<PartnerInviteClaimResult, { status: "claimed" }>["benefits"] = [];
    const trials: Extract<PartnerInviteClaimResult, { status: "claimed" }>["trials"] = [];

    for (const { grant, product } of grants) {
      if (grant.grantType === "partner_benefit") {
        const endsAt = grant.durationDays === null ? null : new Date(now.getTime() + grant.durationDays * DAY_MS);
        await tx.insert(commercialPartnerBenefits).values({
          partnerId: resolved.partner.id,
          productId: product.id,
          locationId: input.locationId,
          startsAt: now,
          endsAt,
        });
        benefits.push({ productId: product.id, startsAt: now, endsAt });
        continue;
      }

      const [existingTrial] = await tx.select().from(locationCoreTrials)
        .where(and(eq(locationCoreTrials.locationId, input.locationId), eq(locationCoreTrials.productId, product.id)));
      if (existingTrial) {
        const active = existingTrial.status === "active" && existingTrial.startsAt <= now && existingTrial.endsAt > now;
        trials.push({ productId: product.id, result: active ? "skipped_active" : "skipped_already_used" });
        continue;
      }

      // Match the existing commercial resolver: active and canceled-but-still
      // within period subscriptions both represent current Product access.
      const [paidAccess] = await tx.select({ id: locationSubscriptions.id }).from(locationSubscriptions)
        .where(and(
          eq(locationSubscriptions.locationId, input.locationId),
          eq(locationSubscriptions.productId, product.id),
          or(eq(locationSubscriptions.status, "active"), eq(locationSubscriptions.status, "canceled")),
          lte(locationSubscriptions.startsAt, now),
          or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now)),
        ));
      if (paidAccess) {
        trials.push({ productId: product.id, result: "skipped_paid_access" });
        continue;
      }

      const [createdTrial] = await tx.insert(locationCoreTrials).values({
        locationId: input.locationId,
        productId: product.id,
        status: "active",
        startsAt: now,
        endsAt: new Date(now.getTime() + (grant.durationDays as number) * DAY_MS),
      }).onConflictDoNothing({ target: [locationCoreTrials.locationId, locationCoreTrials.productId] }).returning({ id: locationCoreTrials.id });
      // The per-Location/Product unique index is the final concurrency guard
      // across different invites racing to create the same one-time trial.
      trials.push({ productId: product.id, result: createdTrial ? "created" : "skipped_already_used" });
    }

    await tx.insert(commercialPartnerInviteClaims).values({
      inviteId: resolved.invite.id,
      locationId: input.locationId,
      claimedAt: now,
    });

    return { status: "claimed", benefits, trials };
  });
}
