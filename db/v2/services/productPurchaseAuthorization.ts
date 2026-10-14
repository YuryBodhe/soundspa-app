import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { v2Db } from "../client";
import { commercialProductOrganizationAuthorizations, commercialProducts } from "../schema";
import { evaluateProductPurchaseEligibility } from "@/lib/v2/productPurchaseModel";

type PurchaseDb = Pick<typeof v2Db, "select">;
type ProductRow = { id: string; isActive: boolean; visibility: "public" | "private" | "disabled" };
export type OrganizationProductPurchaseEligibility = ProductRow & {
  hasOrganizationAuthorization: boolean;
  eligible: boolean;
};

/** Read the current organization grant and catalog visibility for a product set. */
export async function getOrganizationProductPurchaseEligibility(
  db: PurchaseDb,
  organizationId: string,
  productIds: readonly string[],
  options: { lockForShare?: boolean } = {},
): Promise<Map<string, OrganizationProductPurchaseEligibility>> {
  const ids = [...new Set(productIds)].sort();
  if (ids.length === 0) return new Map();

  const productsQuery = db.select({
    id: commercialProducts.id,
    isActive: commercialProducts.isActive,
    visibility: commercialProducts.visibility,
  }).from(commercialProducts).where(inArray(commercialProducts.id, ids)).orderBy(asc(commercialProducts.id));
  const productRows = options.lockForShare ? await productsQuery.for("share") : await productsQuery;

  const grantsQuery = db.select({ productId: commercialProductOrganizationAuthorizations.productId })
    .from(commercialProductOrganizationAuthorizations).where(and(
      eq(commercialProductOrganizationAuthorizations.organizationId, organizationId),
      inArray(commercialProductOrganizationAuthorizations.productId, ids),
      isNull(commercialProductOrganizationAuthorizations.revokedAt),
    )).orderBy(asc(commercialProductOrganizationAuthorizations.productId));
  const grants = options.lockForShare ? await grantsQuery.for("share") : await grantsQuery;
  const authorizedIds = new Set(grants.map((grant) => grant.productId));

  return new Map(productRows.map((product) => {
    const hasOrganizationAuthorization = authorizedIds.has(product.id);
    const decision = evaluateProductPurchaseEligibility({ ...product, hasOrganizationAuthorization });
    return [product.id, { ...product, hasOrganizationAuthorization, eligible: decision.eligible }];
  }));
}

export async function requireOrganizationProductPurchaseEligibility(
  db: PurchaseDb,
  organizationId: string,
  productIds: readonly string[],
  options: { lockForShare?: boolean } = {},
): Promise<Map<string, OrganizationProductPurchaseEligibility>> {
  const eligibility = await getOrganizationProductPurchaseEligibility(db, organizationId, productIds, options);
  if (productIds.some((productId) => !eligibility.get(productId)?.eligible)) {
    // Keep private/disabled/nonexistent product responses indistinguishable to
    // a customer probing the API by Product ID.
    throw new ProductPurchaseUnavailableError();
  }
  return eligibility;
}

export class ProductPurchaseUnavailableError extends Error {
  readonly code = "product_unavailable";
  constructor() {
    super("product_unavailable");
    this.name = "ProductPurchaseUnavailableError";
  }
}
