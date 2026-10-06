import assert from "node:assert/strict";
import test from "node:test";
import { PartnerOfferAdminError, requiredOfferText, validatePartnerOfferGrant } from "./partnerOfferAdminValidation";

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
