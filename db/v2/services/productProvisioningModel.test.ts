import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyProductProvisioning,
  hasExpectedProductIdentity,
  SOUNDSPA_PRODUCT_INITIAL_CATALOG_VISIBILITY,
  soundSpaProductProvisioningUpdate,
} from "./productProvisioningModel";

test("new canonical SoundSpa Basic provisioning is public while reruns preserve operator visibility", () => {
  assert.equal(SOUNDSPA_PRODUCT_INITIAL_CATALOG_VISIBILITY, "public");
  const rerunPatch = soundSpaProductProvisioningUpdate(new Date("2026-10-15T00:00:00.000Z"));
  assert.deepEqual(rerunPatch, { name: "SoundSpa Basic", updatedAt: new Date("2026-10-15T00:00:00.000Z") });
  assert.equal("catalogVisibility" in rerunPatch, false, "reruns must not overwrite operator-configured visibility");
});

test("canonical Product provisioning identity uses stable code and name, not Kind", () => {
  const legacyKindProduct = { code: "soundspa", name: "SoundSpa Basic", isActive: true, kind: "partner" };
  assert.equal(hasExpectedProductIdentity(
    legacyKindProduct,
    { code: "soundspa", name: "SoundSpa Basic" },
  ), true, "a legacy Kind value does not define or invalidate Product identity");
  assert.equal(hasExpectedProductIdentity(
    { code: "spaquatoria", name: "Spaquatoria", isActive: true },
    { code: "spaquatoria", name: "Spaquatoria", isActive: true },
  ), true);
});

test("provisioning rejects conflicting canonical identity and inactive protected Products", () => {
  assert.equal(hasExpectedProductIdentity(
    { code: "soundspa", name: "Unexpected Product", isActive: true },
    { code: "soundspa", name: "SoundSpa Basic" },
  ), false);
  assert.equal(hasExpectedProductIdentity(
    { code: "spaquatoria", name: "Spaquatoria", isActive: false },
    { code: "spaquatoria", name: "Spaquatoria", isActive: true },
  ), false);
  assert.equal(hasExpectedProductIdentity(undefined, { code: "soundspa", name: "SoundSpa Basic" }), false);
});

test("provisioning reuses a matching Product instead of creating a duplicate", () => {
  const expected = { code: "spaquatoria", name: "Spaquatoria", isActive: true };
  const matchingLegacyProduct = { ...expected, kind: "core" };
  assert.equal(classifyProductProvisioning(undefined, expected), "create");
  assert.equal(classifyProductProvisioning(matchingLegacyProduct, expected), "reuse");
  assert.equal(classifyProductProvisioning({ ...expected, name: "Wrong Product" }, expected), "conflict");
});
