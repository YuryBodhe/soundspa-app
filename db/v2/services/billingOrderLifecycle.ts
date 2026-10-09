import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialBillingOrderLines, commercialBillingOrders, commercialPayments, locations } from "../schema";
import { LocationBillingAuthorizationError, requireLocationBillingAuthority } from "./locationBillingPermissions";

type LifecycleDb = Pick<typeof v2Db, "transaction">;

export class BillingOrderLifecycleError extends Error {
  constructor(readonly code: "not_found" | "not_abandonable") {
    super(code);
    this.name = "BillingOrderLifecycleError";
  }
}

/** Retains the audit row while abandoning a draft that has never created a Payment. */
export async function abandonCustomerBillingOrderDraft(input: { authenticatedUserId: string; billingOrderId: string }, db: LifecycleDb = v2Db) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(commercialBillingOrders)
      .where(eq(commercialBillingOrders.id, input.billingOrderId)).for("update").limit(1);
    if (!order) throw new BillingOrderLifecycleError("not_found");
    const lines = await tx.select({
      locationId: commercialBillingOrderLines.locationId,
      organizationId: commercialBillingOrderLines.organizationId,
    }).from(commercialBillingOrderLines)
      .where(eq(commercialBillingOrderLines.orderId, order.id))
      .orderBy(asc(commercialBillingOrderLines.locationId)).for("update");
    if (!lines.length) throw new BillingOrderLifecycleError("not_found");
    const locationIds = [...new Set(lines.map((line) => line.locationId))].sort();
    const locationRows = await tx.select({ id: locations.id, organizationId: locations.organizationId })
      .from(locations).where(and(inArray(locations.id, locationIds), isNull(locations.archivedAt)))
      .orderBy(asc(locations.id)).for("update");
    if (locationRows.length !== locationIds.length || locationRows.some((row) => row.organizationId !== order.organizationId) ||
        lines.some((line) => line.organizationId !== order.organizationId)) {
      throw new BillingOrderLifecycleError("not_found");
    }
    try {
      for (const locationId of locationIds) {
        const authority = await requireLocationBillingAuthority(tx, input.authenticatedUserId, locationId);
        if (authority.organizationId !== order.organizationId) throw new BillingOrderLifecycleError("not_found");
      }
    } catch (error) {
      if (error instanceof BillingOrderLifecycleError) throw error;
      if (error instanceof LocationBillingAuthorizationError) throw new BillingOrderLifecycleError("not_found");
      throw error;
    }
    const [payment] = await tx.select({ id: commercialPayments.id })
      .from(commercialPayments).where(eq(commercialPayments.billingOrderId, order.id)).for("update").limit(1);
    if (order.status !== "draft" || payment) throw new BillingOrderLifecycleError("not_abandonable");
    await tx.update(commercialBillingOrders).set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(commercialBillingOrders.id, order.id), eq(commercialBillingOrders.status, "draft")));
    return { id: order.id, status: "canceled" as const };
  });
}
