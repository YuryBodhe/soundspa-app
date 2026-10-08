import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import {
  locationBillingPermissions,
  locations,
  organizationMembers,
  organizations,
  users,
} from "../schema";
import { canDelegateLocationBilling, canManageLocationBilling } from "./locationBillingAuthorizationModel";

type BillingPermissionTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type BillingPermissionDb = Pick<typeof v2Db, "transaction">;

export class LocationBillingAuthorizationError extends Error {
  constructor(readonly code: "not_authorized" | "manager_required") {
    super(code);
    this.name = "LocationBillingAuthorizationError";
  }
}

/** Shared server-side boundary for order, subscription cancellation and future refund-request operations. */
export async function requireLocationBillingAuthority(
  tx: BillingPermissionTx,
  authenticatedUserId: string,
  locationId: string,
): Promise<{ organizationId: string; role: string }> {
  const [member] = await tx.select({
    organizationId: organizations.id,
    role: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(locations, and(
      eq(locations.organizationId, organizationMembers.organizationId),
      eq(locations.id, locationId),
    ))
    .where(and(
      eq(organizationMembers.userId, authenticatedUserId),
      isNull(users.disabledAt),
      isNotNull(users.emailVerifiedAt),
      isNull(organizations.archivedAt),
      isNull(locations.archivedAt),
    )).for("share").limit(1);
  if (!member) throw new LocationBillingAuthorizationError("not_authorized");

  let hasExplicitPermission = false;
  if (member.role === "manager") {
    const [permission] = await tx.select({ locationId: locationBillingPermissions.locationId })
      .from(locationBillingPermissions)
      .where(and(
        eq(locationBillingPermissions.locationId, locationId),
        eq(locationBillingPermissions.organizationId, member.organizationId),
        eq(locationBillingPermissions.userId, authenticatedUserId),
      )).for("share").limit(1);
    hasExplicitPermission = Boolean(permission);
  }
  if (!canManageLocationBilling(member.role, hasExplicitPermission)) {
    throw new LocationBillingAuthorizationError("not_authorized");
  }
  return { organizationId: member.organizationId, role: member.role };
}

async function requireOwnerDelegationAuthority(tx: BillingPermissionTx, userId: string, locationId: string) {
  const [location] = await tx.select({ id: locations.id, organizationId: locations.organizationId })
    .from(locations).where(and(eq(locations.id, locationId), isNull(locations.archivedAt))).for("update").limit(1);
  if (!location) throw new LocationBillingAuthorizationError("not_authorized");
  const [actor] = await tx.select({ role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(
      eq(organizationMembers.organizationId, location.organizationId),
      eq(organizationMembers.userId, userId),
      isNull(users.disabledAt),
      isNotNull(users.emailVerifiedAt),
      isNull(organizations.archivedAt),
    )).for("share").limit(1);
  if (!actor || !canDelegateLocationBilling(actor.role)) throw new LocationBillingAuthorizationError("not_authorized");
  return location.organizationId;
}

/** Owner-authorized, idempotent delegation to a manager in the same Organization. */
export async function grantLocationBillingPermission(input: {
  authenticatedUserId: string;
  locationId: string;
  managerUserId: string;
}, db: BillingPermissionDb = v2Db) {
  return db.transaction(async (tx) => {
    const organizationId = await requireOwnerDelegationAuthority(tx, input.authenticatedUserId, input.locationId);
    const [manager] = await tx.select({ role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, input.managerUserId),
        eq(organizationMembers.role, "manager"),
        isNull(users.disabledAt),
      )).for("share").limit(1);
    if (!manager || input.managerUserId === input.authenticatedUserId) throw new LocationBillingAuthorizationError("manager_required");
    const inserted = await tx.insert(locationBillingPermissions).values({
      locationId: input.locationId,
      organizationId,
      userId: input.managerUserId,
      grantedByUserId: input.authenticatedUserId,
    }).onConflictDoNothing().returning({ userId: locationBillingPermissions.userId });
    return { locationId: input.locationId, managerUserId: input.managerUserId, granted: inserted.length > 0 };
  });
}

/** Owner-authorized, idempotent revocation of only this Location's delegation. */
export async function revokeLocationBillingPermission(input: {
  authenticatedUserId: string;
  locationId: string;
  managerUserId: string;
}, db: BillingPermissionDb = v2Db) {
  return db.transaction(async (tx) => {
    await requireOwnerDelegationAuthority(tx, input.authenticatedUserId, input.locationId);
    const deleted = await tx.delete(locationBillingPermissions).where(and(
      eq(locationBillingPermissions.locationId, input.locationId),
      eq(locationBillingPermissions.userId, input.managerUserId),
    )).returning({ userId: locationBillingPermissions.userId });
    return { locationId: input.locationId, managerUserId: input.managerUserId, revoked: deleted.length > 0 };
  });
}
