import assert from "node:assert/strict";
import test from "node:test";
import { getPartnerInviteLifecycleStatus, PartnerOfferAdminError, requiredOfferText, validatePartnerInviteOptions, validatePartnerOfferGrant } from "./partnerOfferAdminValidation";

test("Offer text is trimmed and rejects empty values", () => {
  assert.equal(requiredOfferText("  Partner Offer  "), "Partner Offer");
  assert.throws(() => requiredOfferText("  "), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_INPUT");
  assert.throws(() => requiredOfferText(null), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_INPUT");
});

test("partner benefits accept permanent or positive integer duration", () => {
  assert.deepEqual(validatePartnerOfferGrant({ productId: "product", grantType: "partner_benefit", durationDays: null }), {
    productId: "product", grantType: "partner_benefit", durationDays: null,
  });
  assert.equal(validatePartnerOfferGrant({ productId: "product", grantType: "partner_benefit", durationDays: "14" }).durationDays, 14);
});

test("trials require a positive PostgreSQL integer day count", () => {
  assert.equal(validatePartnerOfferGrant({ productId: "product", grantType: "trial", durationDays: 30 }).durationDays, 30);
  for (const durationDays of [null, 0, -1, 1.5, "1.5", "1e2", 2_147_483_648, true]) {
    assert.throws(() => validatePartnerOfferGrant({ productId: "product", grantType: "trial", durationDays }), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_INPUT");
  }
});

test("only supported grant types and non-empty product IDs are accepted", () => {
  assert.throws(() => validatePartnerOfferGrant({ productId: "", grantType: "trial", durationDays: 30 }), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_INPUT");
  assert.throws(() => validatePartnerOfferGrant({ productId: "product", grantType: "unknown", durationDays: 30 }), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_INPUT");
});

test("Invite limits accept unlimited or positive PostgreSQL integer values only", () => {
  assert.equal(validatePartnerInviteOptions({ maxClaims: null, expiresAt: null }).maxClaims, null);
  assert.equal(validatePartnerInviteOptions({ maxClaims: 4, expiresAt: null }).maxClaims, 4);
  for (const maxClaims of [undefined, 0, -1, 1.5, "3", 2_147_483_648]) {
    assert.throws(() => validatePartnerInviteOptions({ maxClaims, expiresAt: null }), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_MAX_CLAIMS");
  }
});

test("Invite expiry must be null or an explicit future timestamp", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(validatePartnerInviteOptions({ maxClaims: null, expiresAt: null }, now).expiresAt, null);
  assert.equal(validatePartnerInviteOptions({ maxClaims: 1, expiresAt: "2030-01-02T00:00:00.000Z" }, now).expiresAt?.toISOString(), "2030-01-02T00:00:00.000Z");
  for (const expiresAt of [undefined, "", "2030-01-01T00:00:00.000Z", "2030-01-02T00:00:00", "not-a-date"]) {
    assert.throws(() => validatePartnerInviteOptions({ maxClaims: null, expiresAt }, now), (error: unknown) => error instanceof PartnerOfferAdminError && error.code === "INVALID_EXPIRY");
  }
});

test("Invite lifecycle status follows revoked, expired, exhausted, active precedence", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(getPartnerInviteLifecycleStatus({ revokedAt: null, expiresAt: null, maxClaims: null, claimCount: 0 }, now), "ACTIVE");
  assert.equal(getPartnerInviteLifecycleStatus({ revokedAt: null, expiresAt: new Date("2029-12-31T00:00:00Z"), maxClaims: null, claimCount: 0 }, now), "EXPIRED");
  assert.equal(getPartnerInviteLifecycleStatus({ revokedAt: null, expiresAt: now, maxClaims: null, claimCount: 0 }, now), "EXPIRED");
  assert.equal(getPartnerInviteLifecycleStatus({ revokedAt: null, expiresAt: null, maxClaims: 2, claimCount: 2 }, now), "EXHAUSTED");
  assert.equal(getPartnerInviteLifecycleStatus({ revokedAt: now, expiresAt: new Date("2029-12-31T00:00:00Z"), maxClaims: 1, claimCount: 1 }, now), "REVOKED");
});
