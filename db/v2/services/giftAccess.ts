import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import { v2Db } from "../client";
import {
  channels,
  giftAccessInvitations,
  organizationChannelGiftGrants,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import {
  giftDurationMonths,
  generateGiftAccessCode,
  canRedeemGiftAccess,
  isGiftAccessUuid,
  planFiniteGiftPeriod,
  rescheduleGiftPeriodsAfterRevocation,
  validateGiftAccessCode,
  validateGiftAccessDuration,
  type GiftGrantPeriod,
} from "./giftAccessModel";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
const defaultTransaction: TransactionRunner = (operation) => v2Db.transaction(operation);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GiftAccessErrorCode =
  | "INVALID_INPUT"
  | "CHANNEL_NOT_FOUND"
  | "INVITATION_NOT_FOUND"
  | "GIFT_GRANT_NOT_FOUND"
  | "INVITATION_UNAVAILABLE"
  | "ALREADY_REDEEMED"
  | "NOT_AUTHORIZED"
  | "CODE_COLLISION";

export class GiftAccessError extends Error {
  constructor(readonly code: GiftAccessErrorCode) {
    super(code);
    this.name = "GiftAccessError";
  }
}

function requireOperator(authorization: unknown): string {
  if (typeof authorization !== "string" || operatorAuthStatus(authorization) !== 200) {
    throw new GiftAccessError("NOT_AUTHORIZED");
  }
  const operator = process.env.V2_ADMIN_USERNAME?.trim();
  if (!operator || operator.length > 160) throw new GiftAccessError("NOT_AUTHORIZED");
  return operator;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

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

function inviteProjection(row: typeof giftAccessInvitations.$inferSelect) {
  const { tokenHash: _tokenHash, ...safe } = row;
  void _tokenHash;
  return safe;
}

/**
 * Trusted operator operation. Any HTTP or job caller must first pass the
 * existing V2 operator authorization boundary; this service creates no route.
 * Plaintext is returned once, while only its SHA-256 hash is persisted.
 */
export async function createGiftAccessInvitation(
  input: { channelId: unknown; duration: unknown; redemptionDeadline?: unknown; operatorAuthorization: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
  now = new Date(),
) {
  const channelId = input.channelId;
  if (!isGiftAccessUuid(channelId) || !Number.isFinite(now.getTime())) throw new GiftAccessError("INVALID_INPUT");
  const duration = validateGiftAccessDuration(input.duration);
  const durationMonths = giftDurationMonths(duration);
  const createdByOperator = requireOperator(input.operatorAuthorization);
  let redemptionDeadline: Date | null = null;
  if (input.redemptionDeadline !== undefined && input.redemptionDeadline !== null) {
    if (!(input.redemptionDeadline instanceof Date) || !Number.isFinite(input.redemptionDeadline.getTime()) || input.redemptionDeadline <= now) {
      throw new GiftAccessError("INVALID_INPUT");
    }
    redemptionDeadline = input.redemptionDeadline;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateGiftAccessCode();
    const tokenHash = hashToken(token);
    try {
      const invitation = await runInTransaction(async (tx) => {
        const [channel] = await tx.select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)).limit(1);
        if (!channel) throw new GiftAccessError("CHANNEL_NOT_FOUND");
        const [row] = await tx.insert(giftAccessInvitations).values({
          id: randomUUID(), tokenHash, channelId, duration, durationMonths,
          redemptionDeadline, createdByOperator,
        }).returning();
        return inviteProjection(row);
      });
      return { token, invitation };
    } catch (error) {
      if (postgresCode(error) === "23505" && attempt < 2) continue;
      if (postgresCode(error) === "23505") throw new GiftAccessError("CODE_COLLISION");
      throw error;
    }
  }
  throw new GiftAccessError("CODE_COLLISION");
}

/** A verified Owner or Admin redeems exactly one code for an explicit Organization. */
export async function redeemGiftAccessInvitation(
  input: { token: unknown; organizationId: unknown; authenticatedUserId: unknown },
  runInTransaction: TransactionRunner = defaultTransaction,
  now = new Date(),
) {
  let token: string;
  try {
    token = validateGiftAccessCode(input.token);
  } catch {
    throw new GiftAccessError("INVITATION_UNAVAILABLE");
  }
  const organizationId = input.organizationId;
  const authenticatedUserId = input.authenticatedUserId;
  if (!isGiftAccessUuid(organizationId) || !isGiftAccessUuid(authenticatedUserId) || !Number.isFinite(now.getTime())) {
    throw new GiftAccessError("NOT_AUTHORIZED");
  }
  const tokenHash = hashToken(token);

  return runInTransaction(async (tx) => {
    const [membership] = await tx.select({
      userId: users.id,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
      role: organizationMembers.role,
      organizationId: organizations.id,
      organizationArchivedAt: organizations.archivedAt,
    }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, authenticatedUserId),
      ))
      .for("update", { of: [users, organizations, organizationMembers] })
      .limit(1);
    if (!membership || !canRedeemGiftAccess(membership)) {
      throw new GiftAccessError("NOT_AUTHORIZED");
    }

    const [invitation] = await tx.select().from(giftAccessInvitations)
      .where(eq(giftAccessInvitations.tokenHash, tokenHash))
      .for("update");
    if (!invitation || invitation.revokedAt || invitation.redeemedAt ||
        (invitation.redemptionDeadline && invitation.redemptionDeadline <= now)) {
      throw new GiftAccessError("INVITATION_UNAVAILABLE");
    }

    // The Organization row is the lock for an empty gift ledger as well as a
    // lock order shared with revocation. It serializes all writes to its gifts.
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, organizationId)).for("update");
    if (!organization) throw new GiftAccessError("NOT_AUTHORIZED");

    const grants = await tx.select().from(organizationChannelGiftGrants)
      .where(and(
        eq(organizationChannelGiftGrants.organizationId, organizationId),
        eq(organizationChannelGiftGrants.channelId, invitation.channelId),
        isNull(organizationChannelGiftGrants.revokedAt),
      ))
      .orderBy(asc(organizationChannelGiftGrants.redeemedAt), asc(organizationChannelGiftGrants.id))
      .for("update");

    const id = randomUUID();
    const durationMonths = invitation.durationMonths;
    let period: Pick<GiftGrantPeriod, "startsAt" | "endsAt"> & {
      billingAnchorDay: number | null;
      billingAnchorIsEndOfMonth: boolean | null;
    };
    if (invitation.duration === "indefinite") {
      period = { startsAt: now, endsAt: null, billingAnchorDay: null, billingAnchorIsEndOfMonth: null };
    } else {
      if (durationMonths !== 3 && durationMonths !== 6 && durationMonths !== 12) throw new GiftAccessError("INVITATION_UNAVAILABLE");
      const planned = planFiniteGiftPeriod({
        id,
        redeemedAt: now,
        durationMonths,
        existingGrants: grants.map((grant) => ({
          ...grant,
          anchorDay: grant.billingAnchorDay,
          anchorIsEndOfMonth: grant.billingAnchorIsEndOfMonth,
        })),
      });
      period = {
        startsAt: planned.startsAt,
        endsAt: planned.endsAt,
        billingAnchorDay: planned.anchorDay,
        billingAnchorIsEndOfMonth: planned.anchorIsEndOfMonth,
      };
    }

    const [redeemedInvitation] = await tx.update(giftAccessInvitations).set({
      redeemedAt: now,
      redeemedOrganizationId: organizationId,
      redeemedByUserId: authenticatedUserId,
      updatedAt: now,
    }).where(and(
      eq(giftAccessInvitations.id, invitation.id),
      isNull(giftAccessInvitations.revokedAt),
      isNull(giftAccessInvitations.redeemedAt),
    )).returning({ id: giftAccessInvitations.id });
    if (!redeemedInvitation) throw new GiftAccessError("INVITATION_UNAVAILABLE");

    const [grant] = await tx.insert(organizationChannelGiftGrants).values({
      id,
      invitationId: invitation.id,
      organizationId,
      channelId: invitation.channelId,
      redeemedByUserId: authenticatedUserId,
      duration: invitation.duration,
      durationMonths,
      redeemedAt: now,
      ...period,
    }).returning();
    return { invitationId: invitation.id, grant };
  });
}

/** Revoke an unused invitation. A redeemed grant has its own separate operation. */
export async function revokeGiftAccessInvitation(
  invitationId: string,
  operatorAuthorization: unknown,
  runInTransaction: TransactionRunner = defaultTransaction,
  now = new Date(),
) {
  if (!UUID_PATTERN.test(invitationId) || !Number.isFinite(now.getTime())) throw new GiftAccessError("INVALID_INPUT");
  const operator = requireOperator(operatorAuthorization);
  return runInTransaction(async (tx) => {
    const [invitation] = await tx.select().from(giftAccessInvitations)
      .where(eq(giftAccessInvitations.id, invitationId)).for("update");
    if (!invitation) throw new GiftAccessError("INVITATION_NOT_FOUND");
    if (invitation.redeemedAt) throw new GiftAccessError("ALREADY_REDEEMED");
    if (invitation.revokedAt) return inviteProjection(invitation);
    const [row] = await tx.update(giftAccessInvitations).set({ revokedAt: now, revokedByOperator: operator, updatedAt: now })
      .where(and(eq(giftAccessInvitations.id, invitationId), isNull(giftAccessInvitations.redeemedAt), isNull(giftAccessInvitations.revokedAt)))
      .returning();
    return inviteProjection(row);
  });
}

/** Revoke one redeemed gift and reflow still-valid later finite gifts from now. */
export async function revokeOrganizationChannelGiftGrant(
  grantId: string,
  operatorAuthorization: unknown,
  runInTransaction: TransactionRunner = defaultTransaction,
  now = new Date(),
) {
  if (!UUID_PATTERN.test(grantId) || !Number.isFinite(now.getTime())) throw new GiftAccessError("INVALID_INPUT");
  const operator = requireOperator(operatorAuthorization);
  return runInTransaction(async (tx) => {
    const [target] = await tx.select({ organizationId: organizationChannelGiftGrants.organizationId })
      .from(organizationChannelGiftGrants).where(eq(organizationChannelGiftGrants.id, grantId)).limit(1);
    if (!target) throw new GiftAccessError("GIFT_GRANT_NOT_FOUND");
    await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, target.organizationId)).for("update");

    const [grant] = await tx.select().from(organizationChannelGiftGrants)
      .where(eq(organizationChannelGiftGrants.id, grantId)).for("update");
    if (!grant) throw new GiftAccessError("GIFT_GRANT_NOT_FOUND");
    if (grant.revokedAt) return { grant, rescheduledGrantIds: [] as string[] };
    const [revoked] = await tx.update(organizationChannelGiftGrants).set({
      revokedAt: now,
      revokedByOperator: operator,
      updatedAt: now,
    }).where(and(eq(organizationChannelGiftGrants.id, grantId), isNull(organizationChannelGiftGrants.revokedAt)))
      .returning();

    const remaining = await tx.select().from(organizationChannelGiftGrants)
      .where(and(
        eq(organizationChannelGiftGrants.organizationId, grant.organizationId),
        eq(organizationChannelGiftGrants.channelId, grant.channelId),
        isNull(organizationChannelGiftGrants.revokedAt),
      ))
      .orderBy(asc(organizationChannelGiftGrants.redeemedAt), asc(organizationChannelGiftGrants.id))
      .for("update");
    const planned = rescheduleGiftPeriodsAfterRevocation({
      now,
      grants: remaining.map((row) => ({
        ...row,
        anchorDay: row.billingAnchorDay,
        anchorIsEndOfMonth: row.billingAnchorIsEndOfMonth,
      })),
    });
    const changed = planned.filter((plan) => {
      const old = remaining.find((row) => row.id === plan.id)!;
      return old.startsAt.getTime() !== plan.startsAt.getTime() || old.endsAt?.getTime() !== plan.endsAt?.getTime() ||
        old.billingAnchorDay !== plan.anchorDay || old.billingAnchorIsEndOfMonth !== plan.anchorIsEndOfMonth;
    });
    if (changed.length) {
      for (const plan of changed) {
        await tx.update(organizationChannelGiftGrants).set({
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
          billingAnchorDay: plan.anchorDay,
          billingAnchorIsEndOfMonth: plan.anchorIsEndOfMonth,
          updatedAt: now,
        }).where(eq(organizationChannelGiftGrants.id, plan.id));
      }
    }
    return { grant: revoked, rescheduledGrantIds: changed.map((row) => row.id) };
  });
}

/** Gift-only effective access; it does not read or modify other access sources. */
export async function getActiveOrganizationChannelGiftAccess(
  organizationId: string,
  channelId: string,
  now = new Date(),
  db: Pick<typeof v2Db, "select"> = v2Db,
) {
  if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(channelId) || !Number.isFinite(now.getTime())) {
    throw new GiftAccessError("INVALID_INPUT");
  }
  const rows = await db.select({
    id: organizationChannelGiftGrants.id,
    duration: organizationChannelGiftGrants.duration,
    startsAt: organizationChannelGiftGrants.startsAt,
    endsAt: organizationChannelGiftGrants.endsAt,
  }).from(organizationChannelGiftGrants).where(and(
    eq(organizationChannelGiftGrants.organizationId, organizationId),
    eq(organizationChannelGiftGrants.channelId, channelId),
    isNull(organizationChannelGiftGrants.revokedAt),
    lte(organizationChannelGiftGrants.startsAt, now),
    or(isNull(organizationChannelGiftGrants.endsAt), gt(organizationChannelGiftGrants.endsAt, now)),
  )).orderBy(asc(organizationChannelGiftGrants.startsAt), asc(organizationChannelGiftGrants.id));
  const indefinite = rows.find((row) => row.duration === "indefinite");
  if (indefinite) return { kind: "indefinite" as const, endsAt: null as Date | null, grantIds: rows.filter((row) => row.duration === "indefinite").map((row) => row.id) };
  const finite = rows.filter((row): row is typeof row & { endsAt: Date } => row.endsAt !== null)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
  const latest = finite[0];
  return latest ? { kind: "finite" as const, endsAt: latest.endsAt, grantIds: finite.filter((row) => row.endsAt.getTime() === latest.endsAt.getTime()).map((row) => row.id) } : null;
}
