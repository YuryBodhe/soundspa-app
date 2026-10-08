import assert from "node:assert/strict";
import test from "node:test";
import { canDelegateLocationBilling, canManageLocationBilling } from "./locationBillingAuthorizationModel";
import { customerDeviceAuthorizationFailure } from "../../../lib/v2/customerDeviceAuthorization";

test("owners and admins retain billing authority; managers require an explicit Location grant", () => {
  assert.equal(canManageLocationBilling("owner", false), true);
  assert.equal(canManageLocationBilling("admin", false), true);
  assert.equal(canManageLocationBilling("manager", false), false);
  assert.equal(canManageLocationBilling("manager", true), true);
  assert.equal(canManageLocationBilling("viewer", true), false);
});

test("billing delegation does not grant membership administration authority", () => {
  assert.equal(canDelegateLocationBilling("owner"), true);
  assert.equal(canDelegateLocationBilling("admin"), false);
  assert.equal(canDelegateLocationBilling("manager"), false);
});

test("a Location billing grant does not make a manager eligible for device management", () => {
  assert.equal(canManageLocationBilling("manager", true), true);
  assert.equal(customerDeviceAuthorizationFailure({
    userFound: true,
    emailVerified: true,
    userDisabled: false,
    locationId: "location-a",
    memberships: [{ locationId: "location-a", role: "manager", locationArchived: false, organizationArchived: false }],
  }), "location_unavailable");
});
