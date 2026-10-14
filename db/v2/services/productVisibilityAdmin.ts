import { and, asc, eq, isNull } from "drizzle-orm";
import { operatorAuthStatus } from "../../../lib/v2/adminOperator";
import { v2Db } from "../client";
import {
  commercialProductOrganizationAuthorizations,
  commercialProductVisibilityEvents,
  commercialProducts,
  organizations,
} from "../schema";
import {
  ProductVisibilityAdminError,
  requireVisibilityConfirmation,
  validateOperatorReason,
  validateProductVisibility,
  validateProductVisibilityIds,
} from "./productVisibilityAdminValidation";

export { ProductVisibilityAdminError, type ProductVisibilityAdminErrorCode, type ProductVisibility } from "./productVisibilityAdminValidation";

type V2Transaction = Parameters<Parameters<typeof v2Db.transaction>[0]>[0];
type TransactionRunner = <T>(operation: (tx: V2Transaction) => Promise<T>) => Promise<T>;
const defaultTransaction: TransactionRunner = (operation) => v2Db.transaction(operation);

function requireOperator(authorization: unknown): string {
  if (typeof authorization !== "string" || operatorAuthStatus(authorization) !== 200) {
    throw new ProductVisibilityAdminError("NOT_AUTHORIZED");
  }
  const operator = process.env.V2_ADMIN_USERNAME?.trim();
  if (!operator || operator.length > 160) throw new ProductVisibilityAdminError("NOT_AUTHORIZED");
  return operator;
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

export async function listProductAuthorizationManagementData(productId: string, operatorAuthorization: unknown) {
  requireOperator(operatorAuthorization);
  validateProductVisibilityIds(productId);
  const [product] = await v2Db.select({ id: commercialProducts.id, name: commercialProducts.name, visibility: commercialProducts.visibility })
    .from(commercialProducts).where(eq(commercialProducts.id, productId)).limit(1);
  if (!product) throw new ProductVisibilityAdminError("PRODUCT_NOT_FOUND");

  const [organizationRows, authorizationRows] = await Promise.all([
    v2Db.select({ id: organizations.id, name: organizations.name, archivedAt: organizations.archivedAt })
      .from(organizations).orderBy(asc(organizations.name), asc(organizations.id)),
    v2Db.select({
      id: commercialProductOrganizationAuthorizations.id,
      organizationId: commercialProductOrganizationAuthorizations.organizationId,
      organizationName: organizations.name,
      grantedAt: commercialProductOrganizationAuthorizations.grantedAt,
      grantedByOperator: commercialProductOrganizationAuthorizations.grantedByOperator,
      grantReason: commercialProductOrganizationAuthorizations.grantReason,
      revokedAt: commercialProductOrganizationAuthorizations.revokedAt,
      revokedByOperator: commercialProductOrganizationAuthorizations.revokedByOperator,
      revokeReason: commercialProductOrganizationAuthorizations.revokeReason,
    }).from(commercialProductOrganizationAuthorizations)
      .innerJoin(organizations, eq(organizations.id, commercialProductOrganizationAuthorizations.organizationId))
      .where(eq(commercialProductOrganizationAuthorizations.productId, productId))
      .orderBy(asc(commercialProductOrganizationAuthorizations.grantedAt), asc(commercialProductOrganizationAuthorizations.id)),
  ]);

  return {
    product,
    organizations: organizationRows.map(({ archivedAt, ...organization }) => ({ ...organization, archived: archivedAt !== null })),
    authorizations: authorizationRows.map((row) => ({ ...row, status: row.revokedAt === null ? "active" as const : "revoked" as const })),
  };
}

export async function updateProductVisibility(input: {
  productId: unknown;
  visibility: unknown;
  reason: unknown;
  confirmed: unknown;
  operatorAuthorization: unknown;
}, runInTransaction: TransactionRunner = defaultTransaction) {
  validateProductVisibilityIds(input.productId);
  const productId = input.productId;
  const visibility = validateProductVisibility(input.visibility);
  const reason = validateOperatorReason(input.reason);
  requireVisibilityConfirmation(input.confirmed);
  const operator = requireOperator(input.operatorAuthorization);

  return runInTransaction(async (tx) => {
    const [product] = await tx.select({ id: commercialProducts.id, visibility: commercialProducts.visibility })
      .from(commercialProducts).where(eq(commercialProducts.id, productId)).for("update").limit(1);
    if (!product) throw new ProductVisibilityAdminError("PRODUCT_NOT_FOUND");
    if (product.visibility === visibility) return { productId, visibility, changed: false };

    const [updated] = await tx.update(commercialProducts).set({ visibility, updatedAt: new Date() })
      .where(eq(commercialProducts.id, productId))
      .returning({ id: commercialProducts.id, visibility: commercialProducts.visibility });
    await tx.insert(commercialProductVisibilityEvents).values({
      productId,
      previousVisibility: product.visibility,
      newVisibility: visibility,
      operator,
      reason,
    });
    return { productId: updated.id, visibility: updated.visibility, changed: true };
  });
}

export async function grantProductPurchaseAuthorization(input: {
  productId: unknown;
  organizationId: unknown;
  reason: unknown;
  operatorAuthorization: unknown;
}, runInTransaction: TransactionRunner = defaultTransaction) {
  validateProductVisibilityIds(input.productId, input.organizationId);
  const productId = input.productId;
  const organizationId = input.organizationId as string;
  const reason = validateOperatorReason(input.reason);
  const operator = requireOperator(input.operatorAuthorization);

  try {
    return await runInTransaction(async (tx) => {
      // The Organization row lock serializes grants with other grants and with
      // Organization deletion's authorization-history check.
      const [organization] = await tx.select({ id: organizations.id, archivedAt: organizations.archivedAt })
        .from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
      if (!organization) throw new ProductVisibilityAdminError("ORGANIZATION_NOT_FOUND");
      if (organization.archivedAt) throw new ProductVisibilityAdminError("ORGANIZATION_ARCHIVED");

      const [product] = await tx.select({ id: commercialProducts.id }).from(commercialProducts)
        .where(eq(commercialProducts.id, productId)).for("key share").limit(1);
      if (!product) throw new ProductVisibilityAdminError("PRODUCT_NOT_FOUND");

      const [active] = await tx.select({ id: commercialProductOrganizationAuthorizations.id })
        .from(commercialProductOrganizationAuthorizations)
        .where(and(
          eq(commercialProductOrganizationAuthorizations.organizationId, organizationId),
          eq(commercialProductOrganizationAuthorizations.productId, productId),
          isNull(commercialProductOrganizationAuthorizations.revokedAt),
        )).limit(1);
      if (active) throw new ProductVisibilityAdminError("AUTHORIZATION_EXISTS");

      const [authorization] = await tx.insert(commercialProductOrganizationAuthorizations).values({
        organizationId, productId, grantedByOperator: operator, grantReason: reason,
      }).returning();
      return authorization;
    });
  } catch (error) {
    if (postgresCode(error) === "23505") throw new ProductVisibilityAdminError("AUTHORIZATION_EXISTS");
    throw error;
  }
}

export async function revokeProductPurchaseAuthorization(input: {
  productId: unknown;
  authorizationId: unknown;
  reason: unknown;
  confirmed: unknown;
  operatorAuthorization: unknown;
}, runInTransaction: TransactionRunner = defaultTransaction) {
  validateProductVisibilityIds(input.productId);
  if (typeof input.authorizationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.authorizationId)) {
    throw new ProductVisibilityAdminError("INVALID_INPUT");
  }
  const productId = input.productId;
  const authorizationId = input.authorizationId;
  const reason = validateOperatorReason(input.reason);
  requireVisibilityConfirmation(input.confirmed);
  const operator = requireOperator(input.operatorAuthorization);

  return runInTransaction(async (tx) => {
    const [authorization] = await tx.select({
      id: commercialProductOrganizationAuthorizations.id,
      revokedAt: commercialProductOrganizationAuthorizations.revokedAt,
    }).from(commercialProductOrganizationAuthorizations)
      .where(and(
        eq(commercialProductOrganizationAuthorizations.id, authorizationId),
        eq(commercialProductOrganizationAuthorizations.productId, productId),
      )).for("update").limit(1);
    if (!authorization) throw new ProductVisibilityAdminError("AUTHORIZATION_NOT_FOUND");
    if (authorization.revokedAt !== null) throw new ProductVisibilityAdminError("AUTHORIZATION_REVOKED");

    const [revoked] = await tx.update(commercialProductOrganizationAuthorizations).set({
      revokedAt: new Date(), revokedByOperator: operator, revokeReason: reason,
    }).where(eq(commercialProductOrganizationAuthorizations.id, authorizationId)).returning();
    return revoked;
  });
}
