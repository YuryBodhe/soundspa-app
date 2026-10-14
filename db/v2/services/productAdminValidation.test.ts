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
    name: "  Divnitsa  ", code: "DIVNITSA", kind: "partner", isActive: true, channelIds: [channelId], priceMinor: 108_000, currency: "RUB", billingIntervalMonths: 1,
  }), { name: "Divnitsa", code: "divnitsa", kind: "partner", isActive: true, channelIds: [channelId], priceMinor: 108_000, currency: "RUB", billingIntervalMonths: 1 });
  assert.deepEqual(validateCreateProductInput({
    name: "Empty composition", code: "empty-composition", kind: "addon", isActive: false, channelIds: [], priceMinor: 50_000, currency: "RUB", billingIntervalMonths: 1,
  }).channelIds, []);
  assert.equal(validateCreateProductInput({
    name: "Kind omitted", code: "kind-omitted", isActive: true, channelIds: [], priceMinor: 50_000, currency: "RUB", billingIntervalMonths: 1,
  }).kind, "core", "the server supplies the compatibility Kind when callers omit it");
  assert.equal(validateCreateProductInput({
    name: "Legacy caller", code: "legacy-kind", kind: "partner", isActive: true, channelIds: [], priceMinor: 50_000, currency: "RUB", billingIntervalMonths: 1,
  }).kind, "partner", "legacy callers that explicitly send a valid Kind remain compatible");
});

test("create rejects invalid, duplicate, or excessive channel selections", () => {
  for (const channelIds of [[channelId, channelId], ["not-a-uuid"], Array.from({ length: 251 }, () => channelId)]) {
    assert.throws(() => validateCreateProductInput({ name: "Name", code: "valid-code", kind: "core", isActive: true, channelIds, priceMinor: 50000, currency: "RUB", billingIntervalMonths: 1 }),
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

test("price policy accepts positive RUB minor units and rejects incomplete or unsupported prices", () => {
  const base = { name: "Price", code: "price", isActive: true, channelIds: [] };
  assert.throws(() => validateCreateProductInput(base),
    (error: unknown) => error instanceof ProductAdminError && error.code === "INVALID_INPUT",
    "new Products must be explicitly priced");
  for (const [priceMinor, currency, billingIntervalMonths] of [
    [0, "RUB", 1], [-1, "RUB", 1], [2_147_483_648, "RUB", 1], [108_000, "USD", 1],
    [108_000, "RUB", 2], [108_000, null, 1],
  ] as const) {
    assert.throws(() => validateCreateProductInput({ ...base, priceMinor, currency, billingIntervalMonths }),
      (error: unknown) => error instanceof ProductAdminError && error.code === "INVALID_INPUT");
  }
  assert.equal(validateUpdateProductInput({ ...base, priceMinor: null, currency: null, billingIntervalMonths: null }).price, null,
    "legacy Products can remain explicitly unconfigured");
  assert.throws(() => validateUpdateProductInput({ ...base, priceMinor: 108_000, currency: null, billingIntervalMonths: null }),
    (error: unknown) => error instanceof ProductAdminError && error.code === "INVALID_INPUT");
});
