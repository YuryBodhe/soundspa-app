import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { v2Db } from "../client";
import { requireLocationBillingAuthority } from "./locationBillingPermissions";
import { planSpaquatoriaPromoPeriods } from "./spaquatoriaPromoModel";
import {
  commercialPartnerBenefits,
  commercialPartners,
  commercialProducts,
  commercialSpaquatoriaPromoCodeEvents,
  commercialSpaquatoriaPromoCodes,
  commercialSpaquatoriaPromoRedemptions,
  locations,
  organizations,
  users,
} from "../schema";

const PARTNER_CODE = "spaquatoria";
const PRODUCT_CODE = "spaquatoria";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Tx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: Tx) => Promise<T>) => Promise<T>;
const transact: TransactionRunner = (operation) => v2Db.transaction(operation);

export type SpaquatoriaPromoErrorCode = "invalid" | "operator_unavailable" | "not_found" | "inactive_configuration" | "redemption_limit_below_usage" | "already_revoked" | "location_unavailable" | "not_authorized" | "promo_unavailable";
export class SpaquatoriaPromoError extends Error {
  constructor(readonly code: SpaquatoriaPromoErrorCode) { super(code); this.name = "SpaquatoriaPromoError"; }
}

function operatorIdentity() {
  const configured = process.env.V2_ADMIN_USERNAME?.trim();
  if (!configured) throw new SpaquatoriaPromoError("operator_unavailable");
  return configured;
}
function requiredReason(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 12 || value.trim().length > 500) throw new SpaquatoriaPromoError("invalid");
  return value.trim();
}
function positiveInteger(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new SpaquatoriaPromoError("invalid");
  return parsed;
}
function optionalMaxRedemptions(value: unknown): number | null {
  if (value === null || value === "") return null;
  return positiveInteger(value, 1, 2_147_483_647);
}
function optionalExpiry(value: unknown, now: Date): Date | null {
  if (value === null || value === "") return null;
  const parsed = value instanceof Date ? new Date(value) : typeof value === "string" ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(parsed.getTime()) || parsed <= now) throw new SpaquatoriaPromoError("invalid");
  return parsed;
}
const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
function publicState(row: typeof commercialSpaquatoriaPromoCodes.$inferSelect) {
  return {
    durationDays: row.durationDays,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxRedemptions: row.maxRedemptions,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedByOperator: row.archivedByOperator,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export function promoCodeStatus(row: { revokedAt: Date | null; expiresAt: Date | null; maxRedemptions: number | null }, redemptionCount: number, now = new Date()) {
  if (row.revokedAt) return "revoked" as const;
  if (row.expiresAt && row.expiresAt <= now) return "expired" as const;
  if (row.maxRedemptions !== null && redemptionCount >= row.maxRedemptions) return "exhausted" as const;
  return "active" as const;
}

export async function createSpaquatoriaPromoCode(input: { durationDays: unknown; expiresAt: unknown; maxRedemptions: unknown; reason: unknown }, now = new Date(), run: TransactionRunner = transact) {
  const operator = operatorIdentity();
  const reason = requiredReason(input.reason);
  const durationDays = positiveInteger(input.durationDays, 1, 365);
  const expiresAt = optionalExpiry(input.expiresAt, now);
  const maxRedemptions = optionalMaxRedemptions(input.maxRedemptions);
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const created = await run(async (tx) => {
    const [target] = await tx.select({ partner: commercialPartners, product: commercialProducts })
      .from(commercialPartners).innerJoin(commercialProducts, eq(commercialProducts.code, PRODUCT_CODE))
      .where(and(eq(commercialPartners.code, PARTNER_CODE), eq(commercialPartners.isActive, true), eq(commercialProducts.isActive, true)))
      .for("share", { of: [commercialPartners, commercialProducts] }).limit(1);
    if (!target) throw new SpaquatoriaPromoError("inactive_configuration");
    const [row] = await tx.insert(commercialSpaquatoriaPromoCodes).values({
      id: randomUUID(), tokenHash: hash, partnerId: target.partner.id, productId: target.product.id,
      durationDays, createdByOperator: operator, creationReason: reason, createdAt: now, expiresAt, maxRedemptions,
    }).returning();
    await tx.insert(commercialSpaquatoriaPromoCodeEvents).values({
      promoCodeId: row.id, action: "created", operator, reason, beforeState: null,
      afterState: { durationDays, expiresAt: expiresAt?.toISOString() ?? null, maxRedemptions, archivedAt: null, archivedByOperator: null, revokedAt: null }, createdAt: now,
    });
    return { id: row.id, createdAt: row.createdAt, durationDays: row.durationDays, expiresAt: row.expiresAt, maxRedemptions: row.maxRedemptions };
  });
  return { promoCode: created, code: token };
}

export async function listSpaquatoriaPromoCodes(now = new Date()) {
  const rows = await v2Db.select({ promo: commercialSpaquatoriaPromoCodes, partnerName: commercialPartners.name, productName: commercialProducts.name, redemptionCount: count(commercialSpaquatoriaPromoRedemptions.id) })
    .from(commercialSpaquatoriaPromoCodes)
    .innerJoin(commercialPartners, eq(commercialPartners.id, commercialSpaquatoriaPromoCodes.partnerId))
    .innerJoin(commercialProducts, eq(commercialProducts.id, commercialSpaquatoriaPromoCodes.productId))
    .leftJoin(commercialSpaquatoriaPromoRedemptions, eq(commercialSpaquatoriaPromoRedemptions.promoCodeId, commercialSpaquatoriaPromoCodes.id))
    .groupBy(commercialSpaquatoriaPromoCodes.id, commercialPartners.id, commercialProducts.id)
    .orderBy(asc(commercialSpaquatoriaPromoCodes.createdAt), asc(commercialSpaquatoriaPromoCodes.id));
  const [redemptions, events] = await Promise.all([
    v2Db.select({ redemption: commercialSpaquatoriaPromoRedemptions, email: users.email, organizationName: organizations.name, locationName: locations.name })
      .from(commercialSpaquatoriaPromoRedemptions).innerJoin(users, eq(users.id, commercialSpaquatoriaPromoRedemptions.verifiedUserId))
      .innerJoin(organizations, eq(organizations.id, commercialSpaquatoriaPromoRedemptions.organizationId))
      .innerJoin(locations, eq(locations.id, commercialSpaquatoriaPromoRedemptions.locationId))
      .orderBy(asc(commercialSpaquatoriaPromoRedemptions.redeemedAt)),
    v2Db.select().from(commercialSpaquatoriaPromoCodeEvents).orderBy(asc(commercialSpaquatoriaPromoCodeEvents.createdAt)),
  ]);
  return rows.map(({ promo, partnerName, productName, redemptionCount }) => {
    const used = Number(redemptionCount);
    return {
      id: promo.id, partnerName, productName, durationDays: promo.durationDays, createdByOperator: promo.createdByOperator,
      creationReason: promo.creationReason, createdAt: promo.createdAt, expiresAt: promo.expiresAt,
      archivedAt: promo.archivedAt, archivedByOperator: promo.archivedByOperator,
      maxRedemptions: promo.maxRedemptions, revokedAt: promo.revokedAt, revokedByOperator: promo.revokedByOperator, revokeReason: promo.revokeReason,
      redemptionCount: used, status: promoCodeStatus(promo, used, now),
      redemptions: redemptions.filter(({ redemption }) => redemption.promoCodeId === promo.id).map(({ redemption, email, organizationName, locationName }) => ({
        id: redemption.id, verifiedUserId: redemption.verifiedUserId, email, organizationId: redemption.organizationId,
        organizationName, locationId: redemption.locationId, locationName, redeemedAt: redemption.redeemedAt,
        requestedDurationDays: redemption.requestedDurationDays, grantedDurationMs: Number(redemption.grantedDurationMs),
      })),
      events: events.filter((event) => event.promoCodeId === promo.id).map((event) => ({ id: event.id, action: event.action, operator: event.operator, reason: event.reason, beforeState: event.beforeState, afterState: event.afterState, createdAt: event.createdAt })),
    };
  });
}

export async function configureSpaquatoriaPromoCode(id: string, input: { durationDays: unknown; expiresAt: unknown; maxRedemptions: unknown; reason: unknown; confirm: unknown }, now = new Date(), run: TransactionRunner = transact) {
  if (!uuidPattern.test(id) || input.confirm !== true) throw new SpaquatoriaPromoError("invalid");
  const operator = operatorIdentity();
  const reason = requiredReason(input.reason);
  const durationDays = positiveInteger(input.durationDays, 1, 365);
  const expiresAt = optionalExpiry(input.expiresAt, now);
  const maxRedemptions = optionalMaxRedemptions(input.maxRedemptions);
  return run(async (tx) => {
    const [row] = await tx.select().from(commercialSpaquatoriaPromoCodes).where(eq(commercialSpaquatoriaPromoCodes.id, id)).for("update").limit(1);
    if (!row) throw new SpaquatoriaPromoError("not_found");
    if (row.revokedAt) throw new SpaquatoriaPromoError("already_revoked");
    const [usage] = await tx.select({ total: count() }).from(commercialSpaquatoriaPromoRedemptions).where(eq(commercialSpaquatoriaPromoRedemptions.promoCodeId, id));
    if (maxRedemptions !== null && maxRedemptions < Number(usage.total)) throw new SpaquatoriaPromoError("redemption_limit_below_usage");
    const next = {
      durationDays, expiresAt: expiresAt?.toISOString() ?? null, maxRedemptions,
      archivedAt: row.archivedAt?.toISOString() ?? null, archivedByOperator: row.archivedByOperator, revokedAt: null,
    };
    const before = publicState(row);
    if (JSON.stringify(before) === JSON.stringify(next)) return { id, changed: false };
    await tx.update(commercialSpaquatoriaPromoCodes).set({ durationDays, expiresAt, maxRedemptions }).where(eq(commercialSpaquatoriaPromoCodes.id, id));
    await tx.insert(commercialSpaquatoriaPromoCodeEvents).values({ promoCodeId: id, action: "configured", operator, reason, beforeState: before, afterState: next, createdAt: now });
    return { id, changed: true };
  });
}

export async function revokeSpaquatoriaPromoCode(id: string, input: { reason: unknown; confirm: unknown }, now = new Date(), run: TransactionRunner = transact) {
  if (!uuidPattern.test(id) || input.confirm !== true) throw new SpaquatoriaPromoError("invalid");
  const operator = operatorIdentity();
  const reason = requiredReason(input.reason);
  return run(async (tx) => {
    const [row] = await tx.select().from(commercialSpaquatoriaPromoCodes).where(eq(commercialSpaquatoriaPromoCodes.id, id)).for("update").limit(1);
    if (!row) throw new SpaquatoriaPromoError("not_found");
    if (row.revokedAt) return { id, changed: false, revokedAt: row.revokedAt };
    const before = publicState(row);
    await tx.update(commercialSpaquatoriaPromoCodes).set({ revokedAt: now, revokedByOperator: operator, revokeReason: reason }).where(eq(commercialSpaquatoriaPromoCodes.id, id));
    await tx.insert(commercialSpaquatoriaPromoCodeEvents).values({ promoCodeId: id, action: "revoked", operator, reason, beforeState: before, afterState: { ...before, revokedAt: now.toISOString() }, createdAt: now });
    return { id, changed: true, revokedAt: now };
  });
}

/** Archive a code without changing its redemption eligibility history or issued benefits. */
export async function archiveSpaquatoriaPromoCode(id: string, input: { reason: unknown; confirm: unknown }, now = new Date(), run: TransactionRunner = transact) {
  if (!uuidPattern.test(id) || input.confirm !== true) throw new SpaquatoriaPromoError("invalid");
  const operator = operatorIdentity();
  const reason = requiredReason(input.reason);
  return run(async (tx) => {
    const [row] = await tx.select().from(commercialSpaquatoriaPromoCodes).where(eq(commercialSpaquatoriaPromoCodes.id, id)).for("update").limit(1);
    if (!row) throw new SpaquatoriaPromoError("not_found");
    if (row.archivedAt) return { id, changed: false, archivedAt: row.archivedAt };
    const before = publicState(row);
    await tx.update(commercialSpaquatoriaPromoCodes).set({ archivedAt: now, archivedByOperator: operator }).where(eq(commercialSpaquatoriaPromoCodes.id, id));
    await tx.insert(commercialSpaquatoriaPromoCodeEvents).values({
      promoCodeId: id, action: "archived", operator, reason, beforeState: before,
      afterState: { ...before, archivedAt: now.toISOString(), archivedByOperator: operator }, createdAt: now,
    });
    return { id, changed: true, archivedAt: now };
  });
}

/** Restore only the archive flag; expiry, limit, and revocation remain untouched. */
export async function restoreSpaquatoriaPromoCode(id: string, input: { reason: unknown; confirm: unknown }, now = new Date(), run: TransactionRunner = transact) {
  if (!uuidPattern.test(id) || input.confirm !== true) throw new SpaquatoriaPromoError("invalid");
  const operator = operatorIdentity();
  const reason = requiredReason(input.reason);
  return run(async (tx) => {
    const [row] = await tx.select().from(commercialSpaquatoriaPromoCodes).where(eq(commercialSpaquatoriaPromoCodes.id, id)).for("update").limit(1);
    if (!row) throw new SpaquatoriaPromoError("not_found");
    if (!row.archivedAt) return { id, changed: false, archivedAt: null };
    const before = publicState(row);
    await tx.update(commercialSpaquatoriaPromoCodes).set({ archivedAt: null, archivedByOperator: null }).where(eq(commercialSpaquatoriaPromoCodes.id, id));
    await tx.insert(commercialSpaquatoriaPromoCodeEvents).values({
      promoCodeId: id, action: "restored", operator, reason, beforeState: before,
      afterState: { ...before, archivedAt: null, archivedByOperator: null }, createdAt: now,
    });
    return { id, changed: true, archivedAt: null };
  });
}

export type RedeemSpaquatoriaPromoResult =
  | { status: "already_covered" }
  | { status: "already_redeemed"; periods: { startsAt: Date; endsAt: Date }[] }
  | { status: "redeemed"; redemptionId: string; periods: { startsAt: Date; endsAt: Date }[]; grantedDurationMs: number };

export async function redeemSpaquatoriaPromoCode(input: { authenticatedUserId: string; locationId: string; code: string }, now = new Date(), run: TransactionRunner = transact): Promise<RedeemSpaquatoriaPromoResult> {
  if (!uuidPattern.test(input.locationId) || typeof input.code !== "string" || input.code.length < 32 || input.code.length > 128) throw new SpaquatoriaPromoError("promo_unavailable");
  return run(async (tx) => {
    // Location is the serialization boundary for different codes redeemed at
    // the same Location. Acquire it before the code lock in every redemption.
    const [location] = await tx.select({ id: locations.id, archivedAt: locations.archivedAt }).from(locations)
      .where(eq(locations.id, input.locationId)).for("update").limit(1);
    if (!location || location.archivedAt) throw new SpaquatoriaPromoError("location_unavailable");
    let authority: { organizationId: string; role: string };
    try { authority = await requireLocationBillingAuthority(tx, input.authenticatedUserId, input.locationId); }
    catch { throw new SpaquatoriaPromoError("not_authorized"); }

    const [promo] = await tx.select().from(commercialSpaquatoriaPromoCodes)
      .where(eq(commercialSpaquatoriaPromoCodes.tokenHash, tokenHash(input.code))).for("update").limit(1);
    if (!promo) throw new SpaquatoriaPromoError("promo_unavailable");
    if (promo.archivedAt) throw new SpaquatoriaPromoError("promo_unavailable");
    const [prior] = await tx.select().from(commercialSpaquatoriaPromoRedemptions).where(and(
      eq(commercialSpaquatoriaPromoRedemptions.promoCodeId, promo.id), eq(commercialSpaquatoriaPromoRedemptions.locationId, input.locationId),
    )).limit(1);
    if (prior) {
      const benefitRows = await tx.select({ startsAt: commercialPartnerBenefits.startsAt, endsAt: commercialPartnerBenefits.endsAt })
        .from(commercialPartnerBenefits).where(eq(commercialPartnerBenefits.promoRedemptionId, prior.id)).orderBy(asc(commercialPartnerBenefits.startsAt));
      return { status: "already_redeemed", periods: benefitRows.flatMap((benefit) => benefit.endsAt ? [{ startsAt: benefit.startsAt, endsAt: benefit.endsAt }] : []) };
    }
    if (promo.revokedAt || (promo.expiresAt && promo.expiresAt <= now)) throw new SpaquatoriaPromoError("promo_unavailable");
    const [partner] = await tx.select().from(commercialPartners).where(and(eq(commercialPartners.id, promo.partnerId), eq(commercialPartners.code, PARTNER_CODE), eq(commercialPartners.isActive, true))).for("share").limit(1);
    const [product] = await tx.select().from(commercialProducts).where(and(eq(commercialProducts.id, promo.productId), eq(commercialProducts.code, PRODUCT_CODE), eq(commercialProducts.isActive, true))).for("share").limit(1);
    if (!partner || !product) throw new SpaquatoriaPromoError("promo_unavailable");

    const existingBenefits = await tx.select({ startsAt: commercialPartnerBenefits.startsAt, endsAt: commercialPartnerBenefits.endsAt })
      .from(commercialPartnerBenefits).where(and(
        eq(commercialPartnerBenefits.partnerId, promo.partnerId), eq(commercialPartnerBenefits.productId, promo.productId),
        eq(commercialPartnerBenefits.locationId, input.locationId),
      )).for("share");
    const plan = planSpaquatoriaPromoPeriods(existingBenefits, now, promo.durationDays);
    if (plan.status === "already_covered") return { status: "already_covered" };

    const [used] = await tx.select({ total: count() }).from(commercialSpaquatoriaPromoRedemptions).where(eq(commercialSpaquatoriaPromoRedemptions.promoCodeId, promo.id));
    if (promo.maxRedemptions !== null && Number(used.total) >= promo.maxRedemptions) throw new SpaquatoriaPromoError("promo_unavailable");

    const [redemption] = await tx.insert(commercialSpaquatoriaPromoRedemptions).values({
      promoCodeId: promo.id, verifiedUserId: input.authenticatedUserId, organizationId: authority.organizationId,
      locationId: input.locationId, partnerId: promo.partnerId, productId: promo.productId,
      requestedDurationDays: promo.durationDays, grantedDurationMs: plan.grantedDurationMs, redeemedAt: now,
    }).returning({ id: commercialSpaquatoriaPromoRedemptions.id });
    for (const period of plan.periods) {
      await tx.insert(commercialPartnerBenefits).values({
        partnerId: promo.partnerId, productId: promo.productId, locationId: input.locationId,
        startsAt: period.startsAt, endsAt: period.endsAt, promoRedemptionId: redemption.id, createdAt: now, updatedAt: now,
      });
    }
    return { status: "redeemed", redemptionId: redemption.id, periods: plan.periods, grantedDurationMs: plan.grantedDurationMs };
  });
}
