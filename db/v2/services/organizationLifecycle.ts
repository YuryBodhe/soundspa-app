import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { v2Db } from "../client";
import { organizationLifecycleEvents, organizations } from "../schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ORGANIZATION_DELETION_BLOCKERS = [
  "orders", "payments", "subscriptions", "trials", "partner_benefits", "promo_redemptions",
  "registration_history", "product_authorizations", "billing_resets", "gift_history",
  "payer_references", "partner_invite_history",
] as const;
export type OrganizationDeletionBlocker = typeof ORGANIZATION_DELETION_BLOCKERS[number];

export class OrganizationLifecycleError extends Error {
  constructor(readonly code: "not_found" | "confirmation_mismatch" | "invalid_reason" | "protected_history" | "database_conflict", readonly blockers: OrganizationDeletionBlocker[] = []) {
    super(code === "not_found" ? "Organization was not found."
      : code === "confirmation_mismatch" ? "The typed Organization name does not match the current Organization name."
        : code === "invalid_reason" ? "Enter a reason between 12 and 500 characters."
          : code === "protected_history" ? "Deletion is blocked because protected commercial history exists."
            : "Organization could not be deleted because a dependent record changed. Refresh and review its history.");
    this.name = "OrganizationLifecycleError";
  }
}

type QueryExecutor = Pick<typeof v2Db, "execute">;
const blockerQuery = (where: ReturnType<typeof sql>) => sql`
  SELECT o.id AS organization_id, array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM commercial_billing_orders bo WHERE bo.organization_id = o.id) THEN 'orders' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_payments p LEFT JOIN commercial_billing_orders bo ON bo.id = p.billing_order_id WHERE bo.organization_id = o.id OR p.location_id IN (SELECT l.id FROM locations l WHERE l.organization_id = o.id)) THEN 'payments' END,
    CASE WHEN EXISTS (SELECT 1 FROM location_subscriptions s JOIN locations l ON l.id = s.location_id WHERE l.organization_id = o.id) THEN 'subscriptions' END,
    CASE WHEN EXISTS (SELECT 1 FROM location_core_trials t JOIN locations l ON l.id = t.location_id WHERE l.organization_id = o.id) THEN 'trials' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_partner_benefits b JOIN locations l ON l.id = b.location_id WHERE l.organization_id = o.id) THEN 'partner_benefits' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_spaquatoria_promo_redemptions r WHERE r.organization_id = o.id) THEN 'promo_redemptions' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_registration_link_redemptions r WHERE r.organization_id = o.id)
      OR EXISTS (SELECT 1 FROM commercial_registration_link_grants g WHERE g.organization_id = o.id) THEN 'registration_history' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_product_organization_authorizations a WHERE a.organization_id = o.id) THEN 'product_authorizations' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_billing_resets r WHERE r.organization_id = o.id) THEN 'billing_resets' END,
    CASE WHEN EXISTS (SELECT 1 FROM gift_access_invitations i WHERE i.redeemed_organization_id = o.id)
      OR EXISTS (SELECT 1 FROM organization_channel_gift_grants g WHERE g.organization_id = o.id) THEN 'gift_history' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_organization_payer_references p WHERE p.organization_id = o.id) THEN 'payer_references' END,
    CASE WHEN EXISTS (SELECT 1 FROM commercial_partner_invite_claims c JOIN locations l ON l.id = c.location_id WHERE l.organization_id = o.id) THEN 'partner_invite_history' END,
    NULL::text
  ], NULL) AS blockers
  FROM organizations o WHERE ${where}
`;

async function blockersFor(executor: QueryExecutor, where: ReturnType<typeof sql>): Promise<OrganizationDeletionBlocker[]> {
  const result = await executor.execute(blockerQuery(where));
  const row = (result as { rows?: Array<{ blockers?: unknown }> }).rows?.[0];
  return Array.isArray(row?.blockers) ? row.blockers.filter((value): value is OrganizationDeletionBlocker =>
    typeof value === "string" && (ORGANIZATION_DELETION_BLOCKERS as readonly string[]).includes(value)) : [];
}

export async function listOrganizationDeletionBlockers(organizationIds: string[]) {
  if (!organizationIds.length) return new Map<string, OrganizationDeletionBlocker[]>();
  const values = sql.join(organizationIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await v2Db.execute(blockerQuery(sql`o.id IN (${values})`));
  const rows = (result as unknown as { rows?: Array<{ blockers?: unknown; organization_id?: string }> }).rows ?? [];
  return new Map(rows.map((row) => [row.organization_id ?? "", Array.isArray(row.blockers) ? row.blockers.filter((value): value is OrganizationDeletionBlocker =>
    typeof value === "string" && (ORGANIZATION_DELETION_BLOCKERS as readonly string[]).includes(value)) : []]));
}

function validateReason(reason: unknown) {
  if (typeof reason !== "string" || reason.trim().length < 12 || reason.trim().length > 500) throw new OrganizationLifecycleError("invalid_reason");
  return reason.trim();
}

function validateTarget(id: string, confirmationName: unknown, reason: unknown, operator: string) {
  if (!UUID.test(id)) throw new OrganizationLifecycleError("not_found");
  if (typeof confirmationName !== "string") throw new OrganizationLifecycleError("confirmation_mismatch");
  if (!operator.trim() || operator.trim().length > 200) throw new OrganizationLifecycleError("invalid_reason");
  return { reason: validateReason(reason), operator: operator.trim() };
}

export async function archiveOrganization(id: string, confirmationName: unknown, rawReason: unknown, operator: string, now = new Date()) {
  const { reason, operator: actor } = validateTarget(id, confirmationName, rawReason, operator);
  return v2Db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id, name: organizations.name, archivedAt: organizations.archivedAt })
      .from(organizations).where(eq(organizations.id, id)).for("update").limit(1);
    if (!organization) throw new OrganizationLifecycleError("not_found");
    if (organization.name !== confirmationName) throw new OrganizationLifecycleError("confirmation_mismatch");
    if (organization.archivedAt) return { changed: false, archivedAt: organization.archivedAt };
    const [updated] = await tx.update(organizations).set({ archivedAt: now, updatedAt: now }).where(and(eq(organizations.id, id), sql`${organizations.archivedAt} IS NULL`)).returning({ archivedAt: organizations.archivedAt });
    if (!updated) throw new OrganizationLifecycleError("database_conflict");
    await tx.insert(organizationLifecycleEvents).values({ organizationId: id, organizationName: organization.name, action: "archived", operator: actor, reason, occurredAt: now });
    return { changed: true, archivedAt: updated.archivedAt };
  });
}

export async function restoreOrganization(id: string, confirmationName: unknown, rawReason: unknown, operator: string, now = new Date()) {
  const { reason, operator: actor } = validateTarget(id, confirmationName, rawReason, operator);
  return v2Db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id, name: organizations.name, archivedAt: organizations.archivedAt })
      .from(organizations).where(eq(organizations.id, id)).for("update").limit(1);
    if (!organization) throw new OrganizationLifecycleError("not_found");
    if (organization.name !== confirmationName) throw new OrganizationLifecycleError("confirmation_mismatch");
    if (!organization.archivedAt) return { changed: false, archivedAt: null };
    await tx.update(organizations).set({ archivedAt: null, updatedAt: now }).where(eq(organizations.id, id));
    await tx.insert(organizationLifecycleEvents).values({ organizationId: id, organizationName: organization.name, action: "restored", operator: actor, reason, occurredAt: now });
    return { changed: true, archivedAt: null };
  });
}

export async function getOrganizationLifecycleHistory(id: string) {
  if (!UUID.test(id)) throw new OrganizationLifecycleError("not_found");
  return v2Db.select().from(organizationLifecycleEvents).where(eq(organizationLifecycleEvents.organizationId, id));
}

export async function listOrganizationLifecycleHistory(organizationIds: string[]) {
  if (!organizationIds.length) return [];
  return v2Db.select().from(organizationLifecycleEvents).where(sql`${organizationLifecycleEvents.organizationId} IN (${sql.join(organizationIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    .orderBy(organizationLifecycleEvents.occurredAt);
}

// Deletion remains available only when every retained commercial/audit dependency is absent.
export async function assertOrganizationHasNoProtectedHistory(tx: QueryExecutor, organizationId: string) {
  const blockers = await blockersFor(tx, sql`o.id = ${organizationId}::uuid`);
  if (blockers.length) throw new OrganizationLifecycleError("protected_history", blockers);
  return blockers;
}
