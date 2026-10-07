import assert from "node:assert/strict";
import {
  customerDeviceAuthorizationFailure,
  CustomerDeviceAuthorizationError,
  provisionAuthorizedCustomerDevice,
  toCustomerDeviceSummary,
} from "../../lib/v2/customerDeviceAuthorization";

const ownLocation = "20000000-0000-4000-8000-000000000001";
const foreignLocation = "20000000-0000-4000-8000-000000000002";
const membership = (locationId: string, role: string, options: { locationArchived?: boolean; organizationArchived?: boolean } = {}) => ({
  locationId,
  role,
  locationArchived: options.locationArchived ?? false,
  organizationArchived: options.organizationArchived ?? false,
});
const authorize = (overrides: Partial<Parameters<typeof customerDeviceAuthorizationFailure>[0]> = {}) => customerDeviceAuthorizationFailure({
  userFound: true,
  emailVerified: true,
  userDisabled: false,
  memberships: [membership(ownLocation, "owner")],
  locationId: ownLocation,
  ...overrides,
});

assert.equal(authorize({ userFound: false }), "unauthenticated");
assert.equal(authorize({ userDisabled: true }), "unauthenticated");
assert.equal(authorize({ emailVerified: false }), "unverified");
assert.equal(authorize({ memberships: [membership(ownLocation, "owner")] }), null);
assert.equal(authorize({ memberships: [membership(ownLocation, "admin")] }), null);
assert.equal(authorize({ memberships: [membership(ownLocation, "manager")] }), "location_unavailable");
assert.equal(authorize({ memberships: [membership(foreignLocation, "owner")] }), "location_unavailable");
assert.equal(authorize({ memberships: [membership(ownLocation, "owner", { locationArchived: true })] }), "location_unavailable");
assert.equal(authorize({ memberships: [membership(ownLocation, "admin", { organizationArchived: true })] }), "location_unavailable");

async function main() {
let canonicalCalls = 0;
const result = await provisionAuthorizedCustomerDevice({
  authenticatedUserId: "user-id",
  locationId: ownLocation,
  deviceName: "Reception tablet",
}, {
  authorize: async (userId, locationId) => {
    assert.equal(userId, "user-id");
    return authorize({ locationId, memberships: [membership(ownLocation, "owner")] });
  },
  createCanonical: async (input) => {
    canonicalCalls += 1;
    assert.deepEqual(input, { locationId: ownLocation, name: "Reception tablet" });
    return { activationToken: "only-test-fixture" };
  },
});
assert.equal(canonicalCalls, 1);
assert.deepEqual(result, { activationToken: "only-test-fixture" });

let deniedCanonicalCalls = 0;
await assert.rejects(provisionAuthorizedCustomerDevice({
  authenticatedUserId: "user-id", locationId: foreignLocation, deviceName: "Tablet",
}, {
  authorize: async (_userId, locationId) => authorize({ locationId, memberships: [membership(ownLocation, "owner")] }),
  createCanonical: async () => { deniedCanonicalCalls += 1; return {}; },
}), (error: unknown) => error instanceof CustomerDeviceAuthorizationError && error.code === "location_unavailable");
assert.equal(deniedCanonicalCalls, 0);

const customerSummary = toCustomerDeviceSummary({
  id: "private-device-id",
  locationId: ownLocation,
  label: "Reception tablet",
  status: "active",
  credentialHash: "private-credential-hash",
  revokedAt: null,
  hasUsableActivationToken: false,
  createdAt: new Date("2026-10-07T00:00:00.000Z"),
});
assert.deepEqual(customerSummary, {
  locationId: ownLocation,
  label: "Reception tablet",
  state: "active",
  activationState: "activated",
  createdAt: "2026-10-07T00:00:00.000Z",
});
assert.equal("id" in customerSummary, false);
assert.equal("credentialHash" in customerSummary, false);
assert.equal("activationTokenHash" in customerSummary, false);
assert.equal(toCustomerDeviceSummary({
  id: "id", locationId: ownLocation, label: null, status: "active", credentialHash: null, revokedAt: null,
  hasUsableActivationToken: true, createdAt: new Date(0),
}).activationState, "awaiting");
assert.equal(toCustomerDeviceSummary({
  id: "id", locationId: ownLocation, label: null, status: "active", credentialHash: null, revokedAt: null,
  hasUsableActivationToken: false, createdAt: new Date(0),
}).activationState, "expired");
assert.equal(toCustomerDeviceSummary({
  id: "id", locationId: ownLocation, label: null, status: "revoked", credentialHash: null, revokedAt: new Date(0),
  hasUsableActivationToken: false, createdAt: new Date(0),
}).activationState, "revoked");

console.info("V2 customer Device authorization PASS: session/verified-user preconditions, owner/admin allowlist, manager/foreign/archived scope denial, canonical provisioner delegation, and hash-free customer Device summaries.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
