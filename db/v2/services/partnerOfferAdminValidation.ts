export type PartnerOfferAdminErrorCode =
  | "INVALID_INPUT"
  | "PARTNER_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "OFFER_NOT_FOUND"
  | "OFFER_CODE_EXISTS"
  | "GRANT_ALREADY_EXISTS"
  | "GRANTS_LOCKED"
  | "OFFER_INACTIVE"
  | "PARTNER_INACTIVE"
  | "OFFER_HAS_NO_GRANTS"
  | "PRODUCT_INACTIVE"
  | "INVALID_MAX_CLAIMS"
  | "INVALID_EXPIRY"
  | "INVITE_NOT_FOUND";

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

export type PartnerInviteLifecycleStatus = "ACTIVE" | "EXPIRED" | "EXHAUSTED" | "REVOKED";

export function validatePartnerInviteOptions(input: { maxClaims: unknown; expiresAt: unknown }, now = new Date()) {
  let maxClaims: number | null;
  if (input.maxClaims === null) maxClaims = null;
  else if (typeof input.maxClaims === "number" && Number.isSafeInteger(input.maxClaims) && input.maxClaims > 0 && input.maxClaims <= 2_147_483_647) maxClaims = input.maxClaims;
  else throw new PartnerOfferAdminError("INVALID_MAX_CLAIMS");

  let expiresAt: Date | null;
  if (input.expiresAt === null) expiresAt = null;
  else {
    if (input.expiresAt instanceof Date) expiresAt = new Date(input.expiresAt.getTime());
    else if (typeof input.expiresAt === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(input.expiresAt)) {
      const parsed = new Date(input.expiresAt);
      expiresAt = Number.isNaN(parsed.getTime()) ? null : parsed;
    } else expiresAt = null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now) throw new PartnerOfferAdminError("INVALID_EXPIRY");
  }
  return { maxClaims, expiresAt };
}

export function getPartnerInviteLifecycleStatus(input: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxClaims: number | null;
  claimCount: number;
}, now = new Date()): PartnerInviteLifecycleStatus {
  if (input.revokedAt !== null) return "REVOKED";
  if (input.expiresAt !== null && input.expiresAt <= now) return "EXPIRED";
  if (input.maxClaims !== null && input.claimCount >= input.maxClaims) return "EXHAUSTED";
  return "ACTIVE";
}
