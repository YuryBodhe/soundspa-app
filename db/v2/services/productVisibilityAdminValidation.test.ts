import assert from "node:assert/strict";
import test from "node:test";
import {
  ProductVisibilityAdminError,
  requireVisibilityConfirmation,
  validateOperatorReason,
  validateProductVisibility,
  validateProductVisibilityIds,
} from "./productVisibilityAdminValidation";

function codeIs(code: string) {
  return (error: unknown) => error instanceof ProductVisibilityAdminError && error.code === code;
}

test("all three visibility modes are accepted and invalid values are rejected", () => {
  for (const value of ["public", "private", "disabled"] as const) assert.equal(validateProductVisibility(value), value);
  assert.throws(() => validateProductVisibility("hidden"), codeIs("INVALID_INPUT"));
  assert.throws(() => validateProductVisibility(null), codeIs("INVALID_INPUT"));
});

test("operator reasons are trimmed, bounded, and reject control characters", () => {
  assert.equal(validateOperatorReason("  planned private launch  "), "planned private launch");
  for (const reason of ["too short", "x".repeat(501), "valid reason\nwith control"]) {
    assert.throws(() => validateOperatorReason(reason), codeIs("INVALID_INPUT"));
  }
});

test("visibility and grant operations require exact explicit confirmation and valid IDs", () => {
  requireVisibilityConfirmation(true);
  assert.throws(() => requireVisibilityConfirmation("yes"), codeIs("CONFIRMATION_REQUIRED"));
  assert.throws(() => validateProductVisibilityIds("not-a-uuid"), codeIs("INVALID_INPUT"));
  assert.throws(() => validateProductVisibilityIds("00000000-0000-4000-8000-000000000001", "bad-org"), codeIs("INVALID_INPUT"));
  assert.doesNotThrow(() => validateProductVisibilityIds("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"));
});
