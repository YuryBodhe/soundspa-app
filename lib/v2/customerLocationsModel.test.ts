import assert from "node:assert/strict";
import test from "node:test";
import {
  customerLocationAuthorizationFailure,
  customerLocationDisplayNameKey,
  customerLocationLimit,
  CustomerLocationError,
  validateCustomerLocationInput,
} from "./customerLocationsModel";

test("Location names are trimmed and valid IANA time zones are retained", () => {
  assert.deepEqual(validateCustomerLocationInput({ name: "  Hamam North  ", timezone: "Europe/Moscow" }), {
    name: "Hamam North", timezone: "Europe/Moscow",
  });
});

test("Location input rejects blank or overlong names and invalid time zones", () => {
  for (const value of [
    { name: "  ", timezone: "UTC" },
    { name: "x".repeat(161), timezone: "UTC" },
    { name: "Spa", timezone: "Mars/Olympus" },
    { name: "Spa", timezone: "" },
  ]) assert.throws(() => validateCustomerLocationInput(value), CustomerLocationError);
});

test("Location cap defaults to 20 and allows a lower explicit configuration only", () => {
  assert.equal(customerLocationLimit(undefined), 20);
  assert.equal(customerLocationLimit("7"), 7);
  assert.throws(() => customerLocationLimit("21"), (error: { code?: string }) => error.code === "configuration");
  assert.throws(() => customerLocationLimit("0"), (error: { code?: string }) => error.code === "configuration");
});

test("only a verified, enabled Owner in a live Organization is authorized", () => {
  const base = { userFound: true, emailVerified: true, userDisabled: false, membershipRole: "owner", organizationArchived: false };
  assert.equal(customerLocationAuthorizationFailure(base), null);
  assert.equal(customerLocationAuthorizationFailure({ ...base, userFound: false }), "unauthenticated");
  assert.equal(customerLocationAuthorizationFailure({ ...base, emailVerified: false }), "unverified");
  assert.equal(customerLocationAuthorizationFailure({ ...base, userDisabled: true }), "owner_required");
  for (const role of ["admin", "manager", null]) assert.equal(customerLocationAuthorizationFailure({ ...base, membershipRole: role }), "owner_required");
  assert.equal(customerLocationAuthorizationFailure({ ...base, organizationArchived: true }), "organization_unavailable");
});

test("Location name comparison uses a trimmed case-insensitive key", () => {
  assert.equal(customerLocationDisplayNameKey("  Hamam NORTH "), "hamam north");
});
