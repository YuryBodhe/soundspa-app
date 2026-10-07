import assert from "node:assert/strict";
import test from "node:test";
import {
  isProductId,
  normalizeProductCode,
  ProductAdminError,
  validateCreateProductInput,
  validateUpdateProductInput,
} from "./productAdminValidation";

const channelId = "e57427e4-d3c6-49ba-87e6-9890974b304c";

test("Product code is normalized and bounded", () => {
  assert.equal(normalizeProductCode("  Spaquatoria Basic_2  "), "spaquatoria-basic-2");
  assert.equal(normalizeProductCode("DIVNITSA"), "divnitsa");
  for (const invalid of ["x", "contains/slash", "ümlaut", "-leading", "trailing-", "a".repeat(81), null]) {
    assert.throws(() => normalizeProductCode(invalid), (error: unknown) =>
      error instanceof ProductAdminError && error.code === "INVALID_INPUT");
  }
});

test("create validates Product fields and preserves selected channel identities", () => {
  assert.deepEqual(validateCreateProductInput({
    name: "  Divnitsa  ", code: "DIVNITSA", kind: "partner", isActive: true, channelIds: [channelId],
  }), { name: "Divnitsa", code: "divnitsa", kind: "partner", isActive: true, channelIds: [channelId] });
  assert.deepEqual(validateCreateProductInput({
    name: "Empty composition", code: "empty-composition", kind: "addon", isActive: false, channelIds: [],
  }).channelIds, []);
});

test("create rejects invalid, duplicate, or excessive channel selections", () => {
  for (const channelIds of [[channelId, channelId], ["not-a-uuid"], Array.from({ length: 251 }, () => channelId)]) {
    assert.throws(() => validateCreateProductInput({ name: "Name", code: "valid-code", kind: "core", isActive: true, channelIds }),
      (error: unknown) => error instanceof ProductAdminError && error.code === "INVALID_INPUT");
  }
});

test("updates accept only editable Product fields and reject invalid identities", () => {
  assert.deepEqual(validateUpdateProductInput({ name: " Changed ", isActive: false, channelIds: [channelId] }), {
    name: "Changed", isActive: false, channelIds: [channelId],
  });
  assert.equal(isProductId(channelId), true);
  assert.equal(isProductId("not-a-product"), false);
  assert.throws(() => validateUpdateProductInput({ name: " ", isActive: true, channelIds: [] }),
    (error: unknown) => error instanceof ProductAdminError && error.code === "INVALID_INPUT");
});
