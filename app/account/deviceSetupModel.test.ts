import assert from "node:assert/strict";
import test from "node:test";
import { currentBrowserOperationStorageKey, getOrCreateCurrentBrowserOperationId, hasActivatedDevice, selectedDeviceSetupLocationId, suggestedFirstSalonName } from "./deviceSetupModel";

test("only an active credentialed Device counts as activated for first-device onboarding", () => {
  assert.equal(hasActivatedDevice([{ id: "a", devices: [] }]), false);
  assert.equal(hasActivatedDevice([{ id: "a", devices: [{ state: "active", activationState: "awaiting" }] }]), false);
  assert.equal(hasActivatedDevice([{ id: "a", devices: [{ state: "revoked", activationState: "revoked" }] }]), false);
  assert.equal(hasActivatedDevice([{ id: "a", devices: [{ state: "active", activationState: "activated" }] }]), true);
});

test("the current-browser operation ID survives retries and is scoped to its Location", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const locationId = "6e991cee-d0be-4442-9dbc-f8e992d0aef1";
  const operationId = "ab773c43-9d6c-42b0-b815-31a57042bc32";
  let generated = 0;
  const createId = () => { generated++; return generated === 1 ? operationId : "cd18f3be-f243-46c7-9bf4-d8f6ad86e2a1"; };
  assert.equal(getOrCreateCurrentBrowserOperationId(locationId, storage, createId), operationId);
  assert.equal(getOrCreateCurrentBrowserOperationId(locationId, storage, createId), operationId, "a lost-response retry must reuse the same operation");
  assert.equal(getOrCreateCurrentBrowserOperationId("e7a3bad1-1afb-442b-8c65-d10e8d214d40", storage, createId), "cd18f3be-f243-46c7-9bf4-d8f6ad86e2a1");
  assert.equal(generated, 2, "a different Location gets its own operation ID");
  assert.equal(currentBrowserOperationStorageKey(locationId), `soundspa-v2:current-browser-device-operation:${locationId}`);
});

test("first-device Location selection stays within the current Organization's authorized Locations", () => {
  const locations = [{ id: "location-a" }, { id: "location-b" }];
  assert.equal(selectedDeviceSetupLocationId(locations, "location-b"), "location-b");
  assert.equal(selectedDeviceSetupLocationId(locations, "foreign-location"), "location-a");
  assert.equal(selectedDeviceSetupLocationId([], "foreign-location"), "");
});

test("first salon follows the company name until the customer edits it", () => {
  assert.equal(suggestedFirstSalonName("Lotus Group", "", false), "Lotus Group");
  assert.equal(suggestedFirstSalonName("Lotus Group Ltd", "Lotus Salon", false), "Lotus Group Ltd");
  assert.equal(suggestedFirstSalonName("Lotus Group Ltd", "Lotus Salon", true), "Lotus Salon");
});
