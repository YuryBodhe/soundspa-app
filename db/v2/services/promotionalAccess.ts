import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialOfferGrants, commercialPartnerInviteClaims, commercialPartnerInvites,
  commercialProducts, commercialRegistrationLinkGrants, locationProductPromotionalAccess,
  locationProductPromotionalAccessEvents, locationSubscriptions, locations, organizationCoreTrialLocations,
  organizationCoreTrials, organizations,
} from "../schema";
import { SOUNDSPA_PRODUCT_CODE } from "../queries/commercialProducts";
import { planPromotionalPeriod, promotionalPeriodEnd, PromotionalAccessConflict, type PromotionalDuration } from "./promotionalAccessModel";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPAQUATORIA_PRODUCT_CODE = "spaquatoria";
const PROMOTIONAL_PREVIEW_TTL_MS = 5 * 60_000;

export type PromotionalAccessErrorCode =
  | "invalid_input" | "location_unavailable" | "product_unavailable" | "source_unavailable"
  | "paid_coverage_conflict" | "existing_promotion_conflict" | "trial_promotion_conflict" | "idempotency_conflict" | "schedule_changed";

export class PromotionalAccessError extends Error {
  constructor(readonly code: PromotionalAccessErrorCode) {
    super(code);
    this.name = "PromotionalAccessError";
  }
}

export type PromotionalAccessStatus = "active" | "upcoming" | "expired" | "revoked";
export type PromotionalAccessRow = typeof locationProductPromotionalAccess.$inferSelect;

type GrantSpec = {
  locationId: string;
  productId: string;
  duration: PromotionalDuration;
  source: "operator" | "registration_link" | "partner_invite";
  operator: string | null;
  reasonCode: string;
  reason: string;
  operatorRequestId: string | null;
  registrationLinkGrantId: string | null;
  partnerInviteClaimId: string | null;
};

function asAccessError(error: unknown): never {
  if (error instanceof PromotionalAccessConflict) {
    if (error.code === "paid_coverage") throw new PromotionalAccessError("paid_coverage_conflict");
    if (error.code === "trial_promotion_overlap") throw new PromotionalAccessError("trial_promotion_conflict");
    throw new PromotionalAccessError("existing_promotion_conflict");
  }
  throw error;
}

function validateSpec(spec: GrantSpec) {
  if (!uuidPattern.test(spec.locationId) || !uuidPattern.test(spec.productId) ||
      !Number.isSafeInteger(spec.duration.value) || spec.duration.value <= 0 ||
      (spec.duration.unit === "calendar_months" && spec.duration.value > 12) ||
      !spec.reason.trim() || spec.reason.trim().length > 500) throw new PromotionalAccessError("invalid_input");
  if (spec.source === "operator") {
    if (!spec.operator?.trim() || !uuidPattern.test(spec.operatorRequestId ?? "") ||
        !["testing", "partner_offer", "compensation", "other"].includes(spec.reasonCode) ||
        spec.registrationLinkGrantId !== null || spec.partnerInviteClaimId !== null) throw new PromotionalAccessError("invalid_input");
  } else if (spec.operator !== null || spec.operatorRequestId !== null || spec.reasonCode !== "source_grant" ||
      (spec.source === "registration_link" ? !spec.registrationLinkGrantId || spec.partnerInviteClaimId !== null : !spec.partnerInviteClaimId || spec.registrationLinkGrantId !== null)) {
    throw new PromotionalAccessError("invalid_input");
  }
}

async function acquireTargetLocks(tx: V2Transaction, locationId: string) {
  const [scope] = await tx.select({
    organizationId: locations.organizationId,
    locationArchivedAt: locations.archivedAt,
    organizationArchivedAt: organizations.archivedAt,
  }).from(locations).innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(eq(locations.id, locationId)).limit(1).for("update", { of: [organizations, locations] });
  if (!scope || scope.locationArchivedAt || scope.organizationArchivedAt) throw new PromotionalAccessError("location_unavailable");
  return scope;
}

async function serverNow(tx: V2Transaction) {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const row = result.rows[0] as { now?: unknown } | undefined;
  const value = row?.now instanceof Date ? row.now : new Date(String(row?.now ?? ""));
  if (!Number.isFinite(value.getTime())) throw new Error("Database server time is unavailable.");
  return value;
}

async function activeBasicTrialEnd(tx: V2Transaction, locationId: string, organizationId: string, now: Date, productId: string) {
  const [basic] = await tx.select({ id: commercialProducts.id }).from(commercialProducts)
    .where(and(eq(commercialProducts.id, productId), eq(commercialProducts.code, SOUNDSPA_PRODUCT_CODE))).limit(1);
  if (!basic) return null;
  const [row] = await tx.select({ startsAt: organizationCoreTrials.startsAt, endsAt: organizationCoreTrials.endsAt, status: organizationCoreTrials.status })
    .from(organizationCoreTrialLocations)
    .innerJoin(organizationCoreTrials, and(eq(organizationCoreTrials.id, organizationCoreTrialLocations.organizationTrialId), eq(organizationCoreTrials.organizationId, organizationId)))
    .where(and(eq(organizationCoreTrialLocations.locationId, locationId), eq(organizationCoreTrials.productId, productId)))
    .limit(1).for("share", { of: [organizationCoreTrialLocations, organizationCoreTrials] });
  return row?.status === "active" && row.startsAt <= now && row.endsAt > now ? row.endsAt : null;
}

async function prepareGrant(tx: V2Transaction, spec: GrantSpec, now: Date) {
  const scope = await acquireTargetLocks(tx, spec.locationId);
  const [product] = await tx.select({ id: commercialProducts.id, code: commercialProducts.code, isActive: commercialProducts.isActive })
    .from(commercialProducts).where(eq(commercialProducts.id, spec.productId)).limit(1).for("share");
  if (!product?.isActive || (spec.source !== "operator" && product.code !== SOUNDSPA_PRODUCT_CODE) || product.code === SPAQUATORIA_PRODUCT_CODE) {
    throw new PromotionalAccessError("product_unavailable");
  }

  const [prior] = spec.source === "operator"
    ? await tx.select().from(locationProductPromotionalAccess).where(eq(locationProductPromotionalAccess.operatorRequestId, spec.operatorRequestId!)).limit(1)
    : spec.source === "registration_link"
      ? await tx.select().from(locationProductPromotionalAccess).where(eq(locationProductPromotionalAccess.registrationLinkGrantId, spec.registrationLinkGrantId!)).limit(1)
      : await tx.select().from(locationProductPromotionalAccess).where(and(eq(locationProductPromotionalAccess.partnerInviteClaimId, spec.partnerInviteClaimId!), eq(locationProductPromotionalAccess.productId, spec.productId))).limit(1);
  if (prior) {
    if (prior.locationId !== spec.locationId || prior.productId !== spec.productId || prior.durationUnit !== spec.duration.unit || prior.durationValue !== spec.duration.value || prior.reason !== spec.reason || prior.reasonCode !== spec.reasonCode || prior.grantedByOperator !== spec.operator) {
      throw new PromotionalAccessError("idempotency_conflict");
    }
    return { prior, scope, now, product, replay: true as const };
  }

  const activePaid = await tx.select({ id: locationSubscriptions.id }).from(locationSubscriptions)
    .where(and(eq(locationSubscriptions.locationId, spec.locationId), eq(locationSubscriptions.productId, spec.productId),
      isNull(locationSubscriptions.invalidatedByResetId), or(eq(locationSubscriptions.status, "active"), eq(locationSubscriptions.status, "canceled")),
      or(isNull(locationSubscriptions.currentPeriodEndsAt), gt(locationSubscriptions.currentPeriodEndsAt, now))))
    .limit(1).for("share");
  if (activePaid.length) throw new PromotionalAccessError("paid_coverage_conflict");

  const promotions = await tx.select({ startsAt: locationProductPromotionalAccess.startsAt, endsAt: locationProductPromotionalAccess.endsAt })
    .from(locationProductPromotionalAccess).where(and(eq(locationProductPromotionalAccess.locationId, spec.locationId),
      eq(locationProductPromotionalAccess.productId, spec.productId), eq(locationProductPromotionalAccess.status, "granted"), gt(locationProductPromotionalAccess.endsAt, now)))
    .orderBy(asc(locationProductPromotionalAccess.startsAt), asc(locationProductPromotionalAccess.id)).for("update");
  const trialEnd = await activeBasicTrialEnd(tx, spec.locationId, scope.organizationId, now, spec.productId);
  let period;
  try {
    period = planPromotionalPeriod({ now, duration: spec.duration, activeBasicTrialEnd: trialEnd, existingPromotions: promotions });
  } catch (error) { asAccessError(error); }
  return { scope, now, product, replay: false as const, period: period! };
}

function auditState(row: PromotionalAccessRow) {
  return {
    id: row.id, locationId: row.locationId, productId: row.productId, source: row.source,
    registrationLinkGrantId: row.registrationLinkGrantId, partnerInviteClaimId: row.partnerInviteClaimId,
    durationUnit: row.durationUnit, durationValue: row.durationValue, grantedAt: row.grantedAt.toISOString(),
    startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), status: row.status,
    grantedByOperator: row.grantedByOperator, reasonCode: row.reasonCode, reason: row.reason,
    revokedAt: row.revokedAt?.toISOString() ?? null, revokedByOperator: row.revokedByOperator, revokeReason: row.revokeReason,
  };
}

async function createPrepared(tx: V2Transaction, spec: GrantSpec, prepared: Awaited<ReturnType<typeof prepareGrant>>) {
  if (prepared.replay) return { status: prepared.prior.status === "revoked" ? "already_revoked" as const : "already_granted" as const, grant: prepared.prior };
  const [grant] = await tx.insert(locationProductPromotionalAccess).values({
    locationId: spec.locationId, productId: spec.productId, source: spec.source,
    registrationLinkGrantId: spec.registrationLinkGrantId, partnerInviteClaimId: spec.partnerInviteClaimId,
    durationUnit: spec.duration.unit, durationValue: spec.duration.value, grantedAt: prepared.now,
    startsAt: prepared.period.startsAt, endsAt: prepared.period.endsAt,
    grantedByOperator: spec.operator, reasonCode: spec.reasonCode, reason: spec.reason.trim(),
    operatorRequestId: spec.operatorRequestId,
  }).returning();
  await tx.insert(locationProductPromotionalAccessEvents).values({
    promotionalAccessId: grant!.id, action: "granted", actorType: spec.source === "operator" ? "operator" : "system",
    operator: spec.operator, reason: spec.reason.trim(), beforeState: null, afterState: auditState(grant!), occurredAt: prepared.now,
  });
  return { status: "granted" as const, grant: grant! };
}

function manualSpec(input: {
  locationId: unknown; productId: unknown; durationUnit: unknown; durationValue: unknown;
  operator: unknown; reasonCode: unknown; reason: unknown; requestId: unknown;
}): GrantSpec {
  if (typeof input.durationUnit !== "string" || !["calendar_months", "days"].includes(input.durationUnit) ||
      typeof input.durationValue !== "number" || typeof input.operator !== "string" ||
      typeof input.reasonCode !== "string" || typeof input.reason !== "string" || typeof input.requestId !== "string") {
    throw new PromotionalAccessError("invalid_input");
  }
  return {
    locationId: String(input.locationId ?? ""), productId: String(input.productId ?? ""),
    duration: { unit: input.durationUnit as PromotionalDuration["unit"], value: input.durationValue },
    source: "operator", operator: input.operator.trim(), reasonCode: input.reasonCode,
    reason: input.reason.trim(), operatorRequestId: input.requestId,
    registrationLinkGrantId: null, partnerInviteClaimId: null,
  };
}

export async function previewManualPromotionalAccess(input: Parameters<typeof manualSpec>[0], dependencies: { runInTransaction?: TransactionRunner; now?: () => Date } = {}) {
  const spec = manualSpec(input); validateSpec(spec);
  const run = dependencies.runInTransaction ?? ((operation) => v2Db.transaction(operation));
  return run(async (tx) => {
    await acquireTargetLocks(tx, spec.locationId);
    const now = dependencies.now?.() ?? await serverNow(tx);
    const prepared = await prepareGrant(tx, spec, now);
    return prepared.replay ? { status: "already_granted" as const, grant: prepared.prior } : { status: "preview" as const, startsAt: prepared.period.startsAt, endsAt: prepared.period.endsAt, duration: spec.duration };
  });
}

function expectedDate(value: unknown): Date | null {
  const date = value instanceof Date ? new Date(value) : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export async function createManualPromotionalAccess(input: Parameters<typeof manualSpec>[0] & { expectedStartsAt: unknown; expectedEndsAt: unknown }, dependencies: { runInTransaction?: TransactionRunner; now?: () => Date } = {}) {
  const spec = manualSpec(input); validateSpec(spec);
  const expectedStartsAt = expectedDate(input.expectedStartsAt);
  const expectedEndsAt = expectedDate(input.expectedEndsAt);
  if (!expectedStartsAt || !expectedEndsAt || expectedEndsAt <= expectedStartsAt) throw new PromotionalAccessError("invalid_input");
  const run = dependencies.runInTransaction ?? ((operation) => v2Db.transaction(operation));
  return run(async (tx) => {
    // Serialize reuse of a request ID even when two calls target different Locations.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spec.operatorRequestId!}::text, 0))`);
    await acquireTargetLocks(tx, spec.locationId);
    const now = dependencies.now?.() ?? await serverNow(tx);
    const prepared = await prepareGrant(tx, spec, now);
    if (!prepared.replay && (prepared.period.startsAt.getTime() !== expectedStartsAt.getTime() || prepared.period.endsAt.getTime() !== expectedEndsAt.getTime())) {
      const previewAgeMs = now.getTime() - expectedStartsAt.getTime();
      const previewEnd = promotionalPeriodEnd(expectedStartsAt, spec.duration);
      const isFreshImmediatePreview = prepared.period.startsAt.getTime() === now.getTime() &&
        previewAgeMs >= 0 && previewAgeMs <= PROMOTIONAL_PREVIEW_TTL_MS &&
        previewEnd.getTime() === expectedEndsAt.getTime();
      if (!isFreshImmediatePreview) throw new PromotionalAccessError("schedule_changed");
      // Keep the dates the operator explicitly reviewed; current paid/trial/queue
      // conflicts were rechecked under the Location lock above.
      prepared.period = { startsAt: expectedStartsAt, endsAt: expectedEndsAt };
    }
    if (prepared.replay && (prepared.prior.startsAt.getTime() !== expectedStartsAt.getTime() || prepared.prior.endsAt.getTime() !== expectedEndsAt.getTime())) {
      throw new PromotionalAccessError("idempotency_conflict");
    }
    return createPrepared(tx, spec, prepared);
  });
}

export async function createRegistrationLinkPromotionalAccess(input: { locationId: string; productId: string; registrationLinkGrantId: string }, dependencies: { runInTransaction?: TransactionRunner; now?: () => Date } = {}) {
  if (!uuidPattern.test(input.locationId) || !uuidPattern.test(input.productId) || !uuidPattern.test(input.registrationLinkGrantId)) throw new PromotionalAccessError("invalid_input");
  const run = dependencies.runInTransaction ?? ((operation) => v2Db.transaction(operation));
  return run(async (tx) => {
    await acquireTargetLocks(tx, input.locationId);
    const now = dependencies.now?.() ?? await serverNow(tx);
    const [source] = await tx.select({ productId: commercialRegistrationLinkGrants.productId, locationId: commercialRegistrationLinkGrants.locationId, accessType: commercialRegistrationLinkGrants.accessType, durationMonths: commercialRegistrationLinkGrants.durationMonths })
      .from(commercialRegistrationLinkGrants).where(eq(commercialRegistrationLinkGrants.id, input.registrationLinkGrantId)).limit(1).for("share");
    if (!source || source.productId !== input.productId || source.locationId !== input.locationId || source.accessType !== "trial") throw new PromotionalAccessError("source_unavailable");
    const spec: GrantSpec = { locationId: input.locationId, productId: input.productId, duration: { unit: "calendar_months", value: source.durationMonths }, source: "registration_link", operator: null, reasonCode: "source_grant", reason: "Registration Link promotional grant", operatorRequestId: null, registrationLinkGrantId: input.registrationLinkGrantId, partnerInviteClaimId: null };
    validateSpec(spec);
    const prepared = await prepareGrant(tx, spec, now);
    return createPrepared(tx, spec, prepared);
  });
}

export async function createPartnerInvitePromotionalAccess(input: { locationId: string; productId: string; partnerInviteClaimId: string }, dependencies: { runInTransaction?: TransactionRunner; now?: () => Date } = {}) {
  if (!uuidPattern.test(input.locationId) || !uuidPattern.test(input.productId) || !uuidPattern.test(input.partnerInviteClaimId)) throw new PromotionalAccessError("invalid_input");
  const run = dependencies.runInTransaction ?? ((operation) => v2Db.transaction(operation));
  return run(async (tx) => {
    await acquireTargetLocks(tx, input.locationId);
    const now = dependencies.now?.() ?? await serverNow(tx);
    const [source] = await tx.select({ locationId: commercialPartnerInviteClaims.locationId, durationDays: commercialOfferGrants.durationDays, grantType: commercialOfferGrants.grantType, productId: commercialOfferGrants.productId })
      .from(commercialPartnerInviteClaims).innerJoin(commercialPartnerInvites, eq(commercialPartnerInvites.id, commercialPartnerInviteClaims.inviteId))
      .innerJoin(commercialOfferGrants, eq(commercialOfferGrants.offerId, commercialPartnerInvites.offerId))
      .where(and(eq(commercialPartnerInviteClaims.id, input.partnerInviteClaimId), eq(commercialOfferGrants.productId, input.productId), eq(commercialOfferGrants.grantType, "trial")))
      .limit(1).for("share", { of: [commercialPartnerInviteClaims, commercialPartnerInvites, commercialOfferGrants] });
    if (!source || source.locationId !== input.locationId || source.productId !== input.productId || !source.durationDays) throw new PromotionalAccessError("source_unavailable");
    const spec: GrantSpec = { locationId: input.locationId, productId: input.productId, duration: { unit: "days", value: source.durationDays }, source: "partner_invite", operator: null, reasonCode: "source_grant", reason: "Partner Invite promotional grant", operatorRequestId: null, registrationLinkGrantId: null, partnerInviteClaimId: input.partnerInviteClaimId };
    validateSpec(spec);
    const prepared = await prepareGrant(tx, spec, now);
    return createPrepared(tx, spec, prepared);
  });
}

export async function listLocationPromotionalAccess(locationId: string, productId?: string, now = new Date()) {
  if (!uuidPattern.test(locationId) || (productId && !uuidPattern.test(productId))) throw new PromotionalAccessError("invalid_input");
  const rows = await v2Db.select({ grant: locationProductPromotionalAccess, productName: commercialProducts.name })
    .from(locationProductPromotionalAccess).innerJoin(commercialProducts, eq(commercialProducts.id, locationProductPromotionalAccess.productId))
    .where(and(eq(locationProductPromotionalAccess.locationId, locationId), ...(productId ? [eq(locationProductPromotionalAccess.productId, productId)] : [])))
    .orderBy(asc(locationProductPromotionalAccess.grantedAt), asc(locationProductPromotionalAccess.id));
  return rows.map(({ grant, productName }) => ({
    ...grant, productName,
    effectiveStatus: grant.status === "revoked" ? "revoked" as const : grant.endsAt <= now ? "expired" as const : grant.startsAt > now ? "upcoming" as const : "active" as const,
  }));
}

export async function revokeLocationPromotionalAccess(input: { id: string; operator: string; reason: string }, dependencies: { runInTransaction?: TransactionRunner; now?: () => Date } = {}) {
  if (!uuidPattern.test(input.id) || !input.operator.trim() || !input.reason.trim() || input.reason.trim().length > 500) throw new PromotionalAccessError("invalid_input");
  const run = dependencies.runInTransaction ?? ((operation) => v2Db.transaction(operation));
  return run(async (tx) => {
    const [target] = await tx.select({ locationId: locationProductPromotionalAccess.locationId })
      .from(locationProductPromotionalAccess).where(eq(locationProductPromotionalAccess.id, input.id)).limit(1);
    if (!target) throw new PromotionalAccessError("source_unavailable");
    await acquireTargetLocks(tx, target.locationId);
    const [existing] = await tx.select().from(locationProductPromotionalAccess)
      .where(eq(locationProductPromotionalAccess.id, input.id)).limit(1).for("update");
    if (!existing) throw new PromotionalAccessError("source_unavailable");
    if (existing.status === "revoked") return { status: "already_revoked" as const, grant: existing };
    const now = dependencies.now?.() ?? await serverNow(tx);
    const [updated] = await tx.update(locationProductPromotionalAccess).set({ status: "revoked", revokedAt: now, revokedByOperator: input.operator.trim(), revokeReason: input.reason.trim(), updatedAt: now })
      .where(and(eq(locationProductPromotionalAccess.id, input.id), eq(locationProductPromotionalAccess.status, "granted"))).returning();
    if (!updated) throw new PromotionalAccessError("source_unavailable");
    await tx.insert(locationProductPromotionalAccessEvents).values({ promotionalAccessId: updated.id, action: "revoked", actorType: "operator", operator: input.operator.trim(), reason: input.reason.trim(), beforeState: auditState(existing), afterState: auditState(updated), occurredAt: now });
    return { status: "revoked" as const, grant: updated };
  });
}
