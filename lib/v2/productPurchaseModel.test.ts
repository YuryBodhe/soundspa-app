import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductPurchaseEligibility } from "./productPurchaseModel";

test("public products are purchasable by every otherwise-authorized customer", () => {
  assert.deepEqual(evaluateProductPurchaseEligibility({ isActive: true, visibility: "public", hasOrganizationAuthorization: false }), { eligible: true });
});

test("private products require an Organization authorization", () => {
  assert.deepEqual(evaluateProductPurchaseEligibility({ isActive: true, visibility: "private", hasOrganizationAuthorization: false }), { eligible: false, reason: "product_unavailable" });
  assert.deepEqual(evaluateProductPurchaseEligibility({ isActive: true, visibility: "private", hasOrganizationAuthorization: true }), { eligible: true });
});

test("disabled or inactive products cannot be purchased regardless of authorization", () => {
  assert.deepEqual(evaluateProductPurchaseEligibility({ isActive: true, visibility: "disabled", hasOrganizationAuthorization: true }), { eligible: false, reason: "product_unavailable" });
  assert.deepEqual(evaluateProductPurchaseEligibility({ isActive: false, visibility: "public", hasOrganizationAuthorization: true }), { eligible: false, reason: "product_unavailable" });
});
