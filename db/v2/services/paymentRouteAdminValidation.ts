import { FAKE_PROVIDER_CODE, FAKE_PROVIDER_MARKET } from "@/lib/v2/fakePaymentProvider";

export const PAYMENT_ROUTE_PROVIDERS = [{ code: FAKE_PROVIDER_CODE, name: "Staging Fake Payment", markets: [FAKE_PROVIDER_MARKET] }] as const;
export type PaymentRouteAction = "created" | "enabled" | "disabled" | "priority_changed";
export type PaymentRouteState = {
  marketCode: string;
  providerCode: string;
  externalReference: string;
  isEnabled: boolean;
  displayOrder: number;
};

export type PaymentRouteAdminErrorCode =
  | "INVALID_INPUT" | "NOT_AUTHORIZED" | "PRODUCT_NOT_FOUND" | "ROUTE_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE" | "ROUTE_CONFIGURATION_UNSUPPORTED" | "ROUTE_IDENTITY_EXISTS"
  | "CONFIRMATION_REQUIRED";

export class PaymentRouteAdminError extends Error {
  constructor(readonly code: PaymentRouteAdminErrorCode) {
    super(code);
    this.name = "PaymentRouteAdminError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_PRIORITY = 2_147_483_647;

export function validatePaymentRouteProductId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PaymentRouteAdminError("INVALID_INPUT");
  return value.toLowerCase();
}

export function validatePaymentRouteId(value: unknown): string {
  return validatePaymentRouteProductId(value);
}

export function validatePaymentRouteConfiguration(input: {
  marketCode: unknown; providerCode: unknown; externalReference: unknown; displayOrder: unknown;
}): Omit<PaymentRouteState, "isEnabled"> {
  if (typeof input.marketCode !== "string" || !/^[A-Z]{2}$/.test(input.marketCode) ||
      typeof input.providerCode !== "string" || typeof input.externalReference !== "string" ||
      !Number.isInteger(input.displayOrder) || (input.displayOrder as number) < 0 || (input.displayOrder as number) > MAX_PRIORITY) {
    throw new PaymentRouteAdminError("INVALID_INPUT");
  }
  const provider = PAYMENT_ROUTE_PROVIDERS.find((candidate) => candidate.code === input.providerCode);
  if (!provider) throw new PaymentRouteAdminError("PROVIDER_UNAVAILABLE");
  if (!(provider.markets as readonly string[]).includes(input.marketCode)) throw new PaymentRouteAdminError("ROUTE_CONFIGURATION_UNSUPPORTED");
  const externalReference = input.externalReference.trim();
  if (!externalReference || externalReference.length > 255 || CONTROL_CHARACTERS.test(externalReference)) {
    throw new PaymentRouteAdminError("INVALID_INPUT");
  }
  return { marketCode: input.marketCode, providerCode: input.providerCode, externalReference, displayOrder: input.displayOrder as number };
}

export function validatePaymentRouteReason(value: unknown): string {
  if (typeof value !== "string") throw new PaymentRouteAdminError("INVALID_INPUT");
  const reason = value.trim();
  if (reason.length < 12 || reason.length > 500 || CONTROL_CHARACTERS.test(reason)) throw new PaymentRouteAdminError("INVALID_INPUT");
  return reason;
}

export function requirePaymentRouteConfirmation(value: unknown): void {
  if (value !== true) throw new PaymentRouteAdminError("CONFIRMATION_REQUIRED");
}

export function validatePaymentRouteChange(input: {
  isEnabled?: unknown; displayOrder?: unknown;
}): { isEnabled?: boolean; displayOrder?: number } {
  const hasEnabled = input.isEnabled !== undefined;
  const hasPriority = input.displayOrder !== undefined;
  if (hasEnabled === hasPriority) throw new PaymentRouteAdminError("INVALID_INPUT");
  if (hasEnabled && typeof input.isEnabled !== "boolean") throw new PaymentRouteAdminError("INVALID_INPUT");
  if (hasPriority && (!Number.isInteger(input.displayOrder) || (input.displayOrder as number) < 0 || (input.displayOrder as number) > MAX_PRIORITY)) {
    throw new PaymentRouteAdminError("INVALID_INPUT");
  }
  return hasEnabled ? { isEnabled: input.isEnabled as boolean } : { displayOrder: input.displayOrder as number };
}
