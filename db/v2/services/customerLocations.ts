import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createLocationSlug } from "@/lib/v2/customerOnboarding";
import { customerLocationAuthorizationFailure, customerLocationLimit, CustomerLocationError, validateCustomerLocationInput } from "@/lib/v2/customerLocationsModel";
import { v2Db } from "../client";
import { locations, organizationMembers, organizations, users } from "../schema";
import { recordLifecycleEvent } from "./monitoringObservability";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type CreatedLocation = { id: string; name: string; slug: string; timezone: string };
type CustomerLocationDependencies = {
  transaction?: (callback: (tx: V2Transaction) => Promise<CreatedLocation>) => Promise<CreatedLocation>;
  limit?: number;
  slugFactory?: (name: string) => string;
  recordEvent?: typeof recordLifecycleEvent;
};

function isLocationSlugConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "locations_slug_unique") return true;
    current = candidate.cause;
  }
  return false;
}

async function createInTransaction(tx: V2Transaction, input: {
  authenticatedUserId: string;
  organizationId: string;
  name: string;
  timezone: string;
}, limit: number, slugFactory: (name: string) => string, recordEvent: typeof recordLifecycleEvent): Promise<CreatedLocation> {
  // Serialize creations for this Organization so duplicate-name and cap checks cannot race.
  const [organization] = await tx.select({ id: organizations.id, name: organizations.name, archivedAt: organizations.archivedAt })
    .from(organizations).where(eq(organizations.id, input.organizationId)).limit(1).for("update");
  if (!organization) throw new CustomerLocationError("organization_unavailable", "Organization is unavailable.");

  const [membership] = await tx.select({
    role: organizationMembers.role,
    emailVerifiedAt: users.emailVerifiedAt,
    disabledAt: users.disabledAt,
  }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.userId, input.authenticatedUserId)))
    .limit(1).for("share");
  if (!membership) throw new CustomerLocationError("organization_unavailable", "Organization is unavailable.");
  const authorizationFailure = customerLocationAuthorizationFailure({
    userFound: true,
    emailVerified: Boolean(membership.emailVerifiedAt),
    userDisabled: Boolean(membership.disabledAt),
    membershipRole: membership.role,
    organizationArchived: Boolean(organization.archivedAt),
  });
  if (authorizationFailure) {
    const statusMessage = authorizationFailure === "owner_required" ? "An active Organization Owner is required." : "Organization is unavailable.";
    throw new CustomerLocationError(authorizationFailure, statusMessage);
  }

  const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(locations)
    .where(eq(locations.organizationId, input.organizationId));
  if ((countRow?.count ?? 0) >= limit) throw new CustomerLocationError("location_limit", "This Organization has reached its Location limit.");

  const [duplicate] = await tx.select({ id: locations.id }).from(locations).where(and(
    eq(locations.organizationId, input.organizationId),
    sql`lower(btrim(${locations.name})) = lower(btrim(${input.name}))`,
  )).limit(1);
  if (duplicate) throw new CustomerLocationError("duplicate_name", "A Location with this name already exists in this Organization.");

  const [location] = await tx.insert(locations).values({
    organizationId: input.organizationId,
    name: input.name,
    slug: slugFactory(input.name),
    timezone: input.timezone,
  }).returning({ id: locations.id, name: locations.name, slug: locations.slug, timezone: locations.timezone });

  await recordEvent(tx, {
    eventType: "location_created",
    organizationId: input.organizationId,
    organizationName: organization.name,
    locationId: location.id,
    locationName: location.name,
  });
  return location;
}

export async function createCustomerLocation(input: {
  authenticatedUserId: string;
  organizationId: string;
  name: unknown;
  timezone: unknown;
}, dependencies: CustomerLocationDependencies = {}) {
  if (!input.authenticatedUserId) throw new CustomerLocationError("unauthenticated", "Sign in to create a Location.");
  const { name, timezone } = validateCustomerLocationInput({ name: input.name, timezone: input.timezone });
  const limit = dependencies.limit ?? customerLocationLimit();
  const transaction = dependencies.transaction ?? ((callback) => v2Db.transaction(callback));
  const slugFactory = dependencies.slugFactory ?? ((locationName: string) => createLocationSlug(locationName, randomUUID()));
  const recordEvent = dependencies.recordEvent ?? recordLifecycleEvent;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await transaction((tx) => createInTransaction(tx, {
        authenticatedUserId: input.authenticatedUserId,
        organizationId: input.organizationId,
        name,
        timezone,
      }, limit, slugFactory, recordEvent));
    } catch (error) {
      if (!isLocationSlugConflict(error)) throw error;
      if (attempt === 2) throw new CustomerLocationError("slug_conflict", "Could not assign a unique Location address. Please try again.");
    }
  }
  throw new CustomerLocationError("slug_conflict", "Could not assign a unique Location address. Please try again.");
}
