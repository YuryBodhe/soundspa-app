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

/** Visibility for the canonical Basic Product on first provisioning only. */
export const SOUNDSPA_PRODUCT_INITIAL_CATALOG_VISIBILITY = "public" as const;

/** Keep the canonical label fresh without overwriting operator-managed fields. */
export function soundSpaProductProvisioningUpdate(updatedAt: Date) {
  return { name: "SoundSpa Basic", updatedAt };
}

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
