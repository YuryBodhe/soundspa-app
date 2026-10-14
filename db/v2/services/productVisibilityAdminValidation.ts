export const PRODUCT_VISIBILITIES = ["public", "private", "disabled"] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

export type ProductVisibilityAdminErrorCode =
  | "INVALID_INPUT"
  | "NOT_AUTHORIZED"
  | "PRODUCT_NOT_FOUND"
  | "ORGANIZATION_NOT_FOUND"
  | "ORGANIZATION_ARCHIVED"
  | "AUTHORIZATION_EXISTS"
  | "AUTHORIZATION_NOT_FOUND"
  | "AUTHORIZATION_REVOKED"
  | "CONFIRMATION_REQUIRED";

export class ProductVisibilityAdminError extends Error {
  constructor(readonly code: ProductVisibilityAdminErrorCode) {
    super(code);
    this.name = "ProductVisibilityAdminError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function validateProductVisibility(value: unknown): ProductVisibility {
  if (typeof value !== "string" || !PRODUCT_VISIBILITIES.includes(value as ProductVisibility)) {
    throw new ProductVisibilityAdminError("INVALID_INPUT");
  }
  return value as ProductVisibility;
}

export function validateOperatorReason(value: unknown): string {
  if (typeof value !== "string") throw new ProductVisibilityAdminError("INVALID_INPUT");
  const reason = value.trim();
  if (reason.length < 12 || reason.length > 500 || CONTROL_CHARACTERS.test(reason)) {
    throw new ProductVisibilityAdminError("INVALID_INPUT");
  }
  return reason;
}

export function validateProductVisibilityIds(productId: unknown, organizationId?: unknown): asserts productId is string {
  if (typeof productId !== "string" || !UUID.test(productId) ||
      (organizationId !== undefined && (typeof organizationId !== "string" || !UUID.test(organizationId)))) {
    throw new ProductVisibilityAdminError("INVALID_INPUT");
  }
}

export function requireVisibilityConfirmation(confirmed: unknown): void {
  if (confirmed !== true) throw new ProductVisibilityAdminError("CONFIRMATION_REQUIRED");
}
