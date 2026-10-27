import assert from "node:assert/strict";
import test from "node:test";
import { CurrentBrowserDeviceSecretError, currentBrowserDeviceSecret, currentBrowserOperationHash, deriveCurrentBrowserDeviceCredential } from "./currentBrowserDeviceCredential";

const operationId = "ab773c43-9d6c-42b0-b815-31a57042bc32";
const context = {
  secret: Buffer.from("dedicated-test-device-activation-secret-32-bytes-minimum"),
  operationId,
  authenticatedUserId: "1f61c2d4-d5c2-4f74-bfe9-d339d9f5b908",
  locationId: "6e991cee-d0be-4442-9dbc-f8e992d0aef1",
  deviceId: "54a7ce39-c0df-4e5f-8e9c-9c0f012d800d",
};

test("device credential derivation is stable and bound to the user, Location, Device, and operation", () => {
  const credential = deriveCurrentBrowserDeviceCredential(context);
  assert.match(credential, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(deriveCurrentBrowserDeviceCredential(context), credential);
  assert.notEqual(deriveCurrentBrowserDeviceCredential({ ...context, locationId: "e7a3bad1-1afb-442b-8c65-d10e8d214d40" }), credential);
  assert.notEqual(deriveCurrentBrowserDeviceCredential({ ...context, authenticatedUserId: "e7a3bad1-1afb-442b-8c65-d10e8d214d40" }), credential);
  assert.notEqual(deriveCurrentBrowserDeviceCredential({ ...context, deviceId: "e7a3bad1-1afb-442b-8c65-d10e8d214d40" }), credential);
  assert.notEqual(deriveCurrentBrowserDeviceCredential({ ...context, operationId: "e7a3bad1-1afb-442b-8c65-d10e8d214d40" }), credential);
});

test("the dedicated secret fails closed and operation identifiers are stored only as a domain-separated hash", () => {
  const priorSecret = process.env.V2_DEVICE_ACTIVATION_SECRET;
  delete process.env.V2_DEVICE_ACTIVATION_SECRET;
  try { assert.throws(() => currentBrowserDeviceSecret(), CurrentBrowserDeviceSecretError); }
  finally { if (priorSecret === undefined) delete process.env.V2_DEVICE_ACTIVATION_SECRET; else process.env.V2_DEVICE_ACTIVATION_SECRET = priorSecret; }
  assert.throws(() => currentBrowserDeviceSecret("too-short"), CurrentBrowserDeviceSecretError);
  assert.throws(() => currentBrowserDeviceSecret("REPLACE_WITH_A_RANDOM_SECRET_LONG_ENOUGH_TO_PASS_LENGTH"), CurrentBrowserDeviceSecretError);
  assert.equal(currentBrowserDeviceSecret(context.secret.toString("utf8")).length >= 32, true);
  assert.equal(currentBrowserOperationHash(operationId), currentBrowserOperationHash(operationId));
  assert.equal(currentBrowserOperationHash(operationId.toUpperCase()), currentBrowserOperationHash(operationId), "UUID casing cannot bypass the unique operation guard");
  assert.notEqual(currentBrowserOperationHash(operationId), operationId);
});
