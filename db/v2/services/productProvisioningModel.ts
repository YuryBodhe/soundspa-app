export type ProductProvisioningIdentity = {
  code: string;
  name: string;
  isActive: boolean;
};

export type ExpectedProductIdentity = {
  code: string;
  name: string;
  isActive?: boolean;
};

export type ProductProvisioningDecision = "create" | "reuse" | "conflict";

/** Provisioning identity intentionally excludes the legacy Product Kind field. */
export function hasExpectedProductIdentity(
  product: ProductProvisioningIdentity | null | undefined,
  expected: ExpectedProductIdentity,
): boolean {
  return Boolean(product && product.code === expected.code && product.name === expected.name &&
    (expected.isActive === undefined || product.isActive === expected.isActive));
}

export function classifyProductProvisioning(
  product: ProductProvisioningIdentity | null | undefined,
  expected: ExpectedProductIdentity,
): ProductProvisioningDecision {
  if (!product) return "create";
  return hasExpectedProductIdentity(product, expected) ? "reuse" : "conflict";
}
