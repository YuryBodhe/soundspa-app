import assert from "node:assert/strict";
import test from "node:test";
import {
  PaymentRouteAdminError,
  requirePaymentRouteConfirmation,
  validatePaymentRouteChange,
  validatePaymentRouteConfiguration,
  validatePaymentRouteId,
  validatePaymentRouteProductId,
  validatePaymentRouteReason,
} from "./paymentRouteAdminValidation";

const productId = "dfb9ee21-af86-4b68-97a0-9bbfa6e4a662";
const routeId = "fb0592fb-3d9c-45a7-9cb7-b712a699a9a3";

function rejectsCode(operation: () => unknown, code: string) {
  assert.throws(operation, (error: unknown) => error instanceof PaymentRouteAdminError && error.code === code);
}

test("route configuration accepts supported RU Fake Provider identifiers without enabling them", () => {
  assert.deepEqual(validatePaymentRouteConfiguration({
    marketCode: "RU", providerCode: "fake-staging", externalReference: " fake-staging-divnitsa ", displayOrder: 0,
  }), { marketCode: "RU", providerCode: "fake-staging", externalReference: "fake-staging-divnitsa", displayOrder: 0 });
  assert.deepEqual(validatePaymentRouteConfiguration({
    marketCode: "RU", providerCode: "manual-bank-transfer", externalReference: "manual-bank-transfer-basic", displayOrder: 0,
  }), { marketCode: "RU", providerCode: "manual-bank-transfer", externalReference: "manual-bank-transfer-basic", displayOrder: 0 });
});

test("route configuration rejects unsupported market/provider and malformed or unsafe values", () => {
  rejectsCode(() => validatePaymentRouteConfiguration({ marketCode: "ru", providerCode: "fake-staging", externalReference: "ref", displayOrder: 0 }), "INVALID_INPUT");
  rejectsCode(() => validatePaymentRouteConfiguration({ marketCode: "VN", providerCode: "fake-staging", externalReference: "ref", displayOrder: 0 }), "ROUTE_CONFIGURATION_UNSUPPORTED");
  rejectsCode(() => validatePaymentRouteConfiguration({ marketCode: "RU", providerCode: "prodamus", externalReference: "ref", displayOrder: 0 }), "PROVIDER_UNAVAILABLE");
  for (const externalReference of ["", "  ", "x".repeat(256), "ref\nsecret"]) {
    rejectsCode(() => validatePaymentRouteConfiguration({ marketCode: "RU", providerCode: "fake-staging", externalReference, displayOrder: 0 }), "INVALID_INPUT");
  }
  for (const displayOrder of [-1, 1.2, 2_147_483_648, NaN]) {
    rejectsCode(() => validatePaymentRouteConfiguration({ marketCode: "RU", providerCode: "fake-staging", externalReference: "ref", displayOrder }), "INVALID_INPUT");
  }
});

test("route IDs, reasons, mutations, and enable confirmations are strictly validated", () => {
  assert.equal(validatePaymentRouteProductId(productId), productId);
  assert.equal(validatePaymentRouteId(routeId), routeId);
  rejectsCode(() => validatePaymentRouteId("bad-id"), "INVALID_INPUT");
  assert.equal(validatePaymentRouteReason("  Reviewed route change  "), "Reviewed route change");
  for (const reason of ["short", "x".repeat(501), "bad\nreason"]) rejectsCode(() => validatePaymentRouteReason(reason), "INVALID_INPUT");
  assert.deepEqual(validatePaymentRouteChange({ isEnabled: false }), { isEnabled: false });
  assert.deepEqual(validatePaymentRouteChange({ displayOrder: 5 }), { displayOrder: 5 });
  rejectsCode(() => validatePaymentRouteChange({ isEnabled: true, displayOrder: 1 }), "INVALID_INPUT");
  rejectsCode(() => validatePaymentRouteChange({}), "INVALID_INPUT");
  rejectsCode(() => requirePaymentRouteConfirmation(false), "CONFIRMATION_REQUIRED");
  assert.doesNotThrow(() => requirePaymentRouteConfirmation(true));
});
