import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import {
  commercialSpaquatoriaGiftDrafts, locations, organizationMembers, organizations, users,
} from "../schema";
import {
  mergeSpaquatoriaGiftDraft, missingSpaquatoriaGiftDraftFields, normalizeSpaquatoriaGiftDraftPatch,
  type SpaquatoriaGiftDraftFields,
} from "./spaquatoriaGiftDraftModel";

type DraftTx = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const editableRoles = ["owner", "admin"] as const;

export class SpaquatoriaGiftDraftError extends Error {
  constructor(readonly code: "invalid_input" | "not_authorized" | "location_unavailable" | "draft_unavailable" | "version_conflict") {
    super(code);
    this.name = "SpaquatoriaGiftDraftError";
  }
}

function validActor(userId: string): boolean {
  return UUID.test(userId);
}

function fieldsFromDraft(row: typeof commercialSpaquatoriaGiftDrafts.$inferSelect): SpaquatoriaGiftDraftFields {
  return {
    legalForm: row.legalForm,
    legalName: row.legalName,
    taxId: row.taxId,
    registrationNumber: row.registrationNumber,
    registeredAddress: row.registeredAddress,
    physicalAddress: row.physicalAddress,
    normalizedPhysicalAddress: row.normalizedPhysicalAddress,
    representativeName: row.representativeName,
    representativeRole: row.representativeRole,
    representativeEmail: row.representativeEmail,
    representativePhone: row.representativePhone,
    authorityStatement: row.authorityStatement,
  };
}

async function lockAuthorizedLocation(tx: DraftTx, input: { userId: string; organizationId: string; locationId: string }) {
  const [scope] = await tx.select({ organizationId: organizations.id, locationId: locations.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(locations, and(eq(locations.organizationId, organizations.id), eq(locations.id, input.locationId)))
    .where(and(
      eq(organizationMembers.organizationId, input.organizationId),
      eq(organizationMembers.userId, input.userId),
      inArray(organizationMembers.role, [...editableRoles]),
      isNotNull(users.emailVerifiedAt), isNull(users.disabledAt),
      isNull(organizations.archivedAt), isNull(locations.archivedAt),
    )).limit(1).for("update", { of: [organizationMembers, users, organizations, locations] });
  if (!scope) throw new SpaquatoriaGiftDraftError("location_unavailable");
  return scope;
}

/** Any verified Organization Owner/Admin may resume its shared Location draft; the original creator is retained. */
export async function createOrResumeSpaquatoriaGiftDraft(input: {
  authenticatedUserId: string; organizationId: string; locationId: string; now?: Date;
}) {
  if (!validActor(input.authenticatedUserId) || !UUID.test(input.organizationId) || !UUID.test(input.locationId)) {
    throw new SpaquatoriaGiftDraftError("invalid_input");
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new SpaquatoriaGiftDraftError("invalid_input");
  return v2Db.transaction(async (tx) => {
    await lockAuthorizedLocation(tx, { userId: input.authenticatedUserId, organizationId: input.organizationId, locationId: input.locationId });
    const [existing] = await tx.select().from(commercialSpaquatoriaGiftDrafts)
      .where(and(
        eq(commercialSpaquatoriaGiftDrafts.organizationId, input.organizationId),
        eq(commercialSpaquatoriaGiftDrafts.locationId, input.locationId),
      )).limit(1).for("update");
    if (existing) return { draft: existing, resumed: true, missingFields: missingSpaquatoriaGiftDraftFields(fieldsFromDraft(existing)) };

    const [draft] = await tx.insert(commercialSpaquatoriaGiftDrafts).values({
      organizationId: input.organizationId,
      locationId: input.locationId,
      createdByUserId: input.authenticatedUserId,
      updatedByUserId: input.authenticatedUserId,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!draft) throw new SpaquatoriaGiftDraftError("draft_unavailable");
    return { draft, resumed: false, missingFields: missingSpaquatoriaGiftDraftFields(fieldsFromDraft(draft)) };
  });
}

/** Optimistic version checks prevent one authorized editor silently overwriting another's changes. */
export async function updateSpaquatoriaGiftDraft(input: {
  authenticatedUserId: string; draftId: string; expectedVersion: number; patch: unknown; now?: Date;
}) {
  if (!validActor(input.authenticatedUserId) || !UUID.test(input.draftId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new SpaquatoriaGiftDraftError("invalid_input");
  }
  const patch = normalizeSpaquatoriaGiftDraftPatch(input.patch);
  if (!Object.keys(patch).length) throw new SpaquatoriaGiftDraftError("invalid_input");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new SpaquatoriaGiftDraftError("invalid_input");

  return v2Db.transaction(async (tx) => {
    const [current] = await tx.select({ draft: commercialSpaquatoriaGiftDrafts })
      .from(commercialSpaquatoriaGiftDrafts)
      .innerJoin(organizationMembers, and(
        eq(organizationMembers.organizationId, commercialSpaquatoriaGiftDrafts.organizationId),
        eq(organizationMembers.userId, input.authenticatedUserId),
        inArray(organizationMembers.role, [...editableRoles]),
      ))
      .innerJoin(users, and(eq(users.id, organizationMembers.userId), isNotNull(users.emailVerifiedAt), isNull(users.disabledAt)))
      .innerJoin(organizations, and(eq(organizations.id, commercialSpaquatoriaGiftDrafts.organizationId), isNull(organizations.archivedAt)))
      .innerJoin(locations, and(eq(locations.id, commercialSpaquatoriaGiftDrafts.locationId), eq(locations.organizationId, organizations.id), isNull(locations.archivedAt)))
      .where(eq(commercialSpaquatoriaGiftDrafts.id, input.draftId))
      .limit(1).for("update", { of: [commercialSpaquatoriaGiftDrafts, organizationMembers, users, organizations, locations] });
    if (!current) throw new SpaquatoriaGiftDraftError("draft_unavailable");
    if (current.draft.version !== input.expectedVersion) throw new SpaquatoriaGiftDraftError("version_conflict");

    const values = mergeSpaquatoriaGiftDraft(fieldsFromDraft(current.draft), patch);
    const [draft] = await tx.update(commercialSpaquatoriaGiftDrafts).set({
      ...values,
      updatedByUserId: input.authenticatedUserId,
      updatedAt: now,
      version: current.draft.version + 1,
    }).where(and(
      eq(commercialSpaquatoriaGiftDrafts.id, input.draftId),
      eq(commercialSpaquatoriaGiftDrafts.organizationId, current.draft.organizationId),
      eq(commercialSpaquatoriaGiftDrafts.locationId, current.draft.locationId),
      eq(commercialSpaquatoriaGiftDrafts.version, input.expectedVersion),
    )).returning();
    if (!draft) throw new SpaquatoriaGiftDraftError("version_conflict");
    return { draft, resumed: true, missingFields: missingSpaquatoriaGiftDraftFields(fieldsFromDraft(draft)) };
  });
}

/** PII-bearing drafts are returned only to verified active Owners/Admins for active Locations in their Organizations. */
export async function listSpaquatoriaGiftDraftsForUser(authenticatedUserId: string) {
  if (!validActor(authenticatedUserId)) throw new SpaquatoriaGiftDraftError("not_authorized");
  const rows = await v2Db.select({
    draft: commercialSpaquatoriaGiftDrafts,
    organizationName: organizations.name,
    locationName: locations.name,
  }).from(commercialSpaquatoriaGiftDrafts)
    .innerJoin(organizationMembers, and(
      eq(organizationMembers.organizationId, commercialSpaquatoriaGiftDrafts.organizationId),
      eq(organizationMembers.userId, authenticatedUserId),
      inArray(organizationMembers.role, [...editableRoles]),
    ))
    .innerJoin(users, and(eq(users.id, organizationMembers.userId), isNotNull(users.emailVerifiedAt), isNull(users.disabledAt)))
    .innerJoin(organizations, and(eq(organizations.id, commercialSpaquatoriaGiftDrafts.organizationId), isNull(organizations.archivedAt)))
    .innerJoin(locations, and(eq(locations.id, commercialSpaquatoriaGiftDrafts.locationId), eq(locations.organizationId, organizations.id), isNull(locations.archivedAt)))
    .orderBy(asc(organizations.name), asc(locations.name), asc(commercialSpaquatoriaGiftDrafts.createdAt));
  return rows.map((row) => ({ ...row, missingFields: missingSpaquatoriaGiftDraftFields(fieldsFromDraft(row.draft)) }));
}
