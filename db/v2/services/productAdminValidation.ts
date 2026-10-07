export type ProductKind = "core" | "partner" | "addon";
export type ProductAdminErrorCode = "INVALID_INPUT" | "PRODUCT_CODE_EXISTS" | "PRODUCT_NOT_FOUND" | "CHANNEL_NOT_FOUND";

export class ProductAdminError extends Error {
  constructor(readonly code: ProductAdminErrorCode) {
    super(code);
    this.name = "ProductAdminError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeProductCode(value: unknown): string {
  if (typeof value !== "string") throw new ProductAdminError("INVALID_INPUT");
  const code = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (code.length < 2 || code.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
    throw new ProductAdminError("INVALID_INPUT");
  }
  return code;
}

function productName(value: unknown): string {
  if (typeof value !== "string") throw new ProductAdminError("INVALID_INPUT");
  const name = value.trim();
  if (!name || name.length > 160) throw new ProductAdminError("INVALID_INPUT");
  return name;
}

function productKind(value: unknown): ProductKind {
  if (value !== "core" && value !== "partner" && value !== "addon") throw new ProductAdminError("INVALID_INPUT");
  return value;
}

function channelIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 250 || value.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
    throw new ProductAdminError("INVALID_INPUT");
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new ProductAdminError("INVALID_INPUT");
  return ids;
}

export function validateCreateProductInput(input: {
  name: unknown;
  code: unknown;
  kind: unknown;
  isActive: unknown;
  channelIds: unknown;
}) {
  if (typeof input.isActive !== "boolean") throw new ProductAdminError("INVALID_INPUT");
  return {
    name: productName(input.name),
    code: normalizeProductCode(input.code),
    kind: productKind(input.kind),
    isActive: input.isActive,
    channelIds: channelIds(input.channelIds),
  };
}

export function validateUpdateProductInput(input: {
  name: unknown;
  isActive: unknown;
  channelIds: unknown;
}) {
  if (typeof input.isActive !== "boolean") throw new ProductAdminError("INVALID_INPUT");
  return {
    name: productName(input.name),
    isActive: input.isActive,
    channelIds: channelIds(input.channelIds),
  };
}

export function isProductId(value: string): boolean {
  return uuidPattern.test(value);
}
