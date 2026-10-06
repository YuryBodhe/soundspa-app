export type PartnerOfferAdminErrorCode =
  | "INVALID_INPUT"
  | "PARTNER_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "OFFER_NOT_FOUND"
  | "OFFER_CODE_EXISTS"
  | "GRANT_ALREADY_EXISTS"
  | "GRANTS_LOCKED";

export class PartnerOfferAdminError extends Error {
  constructor(readonly code: PartnerOfferAdminErrorCode) {
    super(code);
    this.name = "PartnerOfferAdminError";
  }
}

export function requiredOfferText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new PartnerOfferAdminError("INVALID_INPUT");
  return value.trim();
}

export type ValidPartnerOfferGrant = {
  productId: string;
  grantType: "partner_benefit" | "trial";
  durationDays: number | null;
};

export function validatePartnerOfferGrant(input: {
  productId: unknown;
  grantType: unknown;
  durationDays: unknown;
}): ValidPartnerOfferGrant {
  const productId = requiredOfferText(input.productId);
  const grantType = input.grantType;
  if (grantType !== "partner_benefit" && grantType !== "trial") throw new PartnerOfferAdminError("INVALID_INPUT");
  const rawDuration = input.durationDays;
  let durationDays: number | null;
  if (rawDuration === undefined || rawDuration === null || rawDuration === "") durationDays = null;
  else {
    if (typeof rawDuration !== "number" && (typeof rawDuration !== "string" || !/^\d+$/.test(rawDuration))) throw new PartnerOfferAdminError("INVALID_INPUT");
    durationDays = Number(rawDuration);
    if (!Number.isSafeInteger(durationDays) || durationDays <= 0 || durationDays > 2_147_483_647) throw new PartnerOfferAdminError("INVALID_INPUT");
  }
  if (grantType === "trial" && durationDays === null) throw new PartnerOfferAdminError("INVALID_INPUT");
  return { productId, grantType, durationDays };
}
