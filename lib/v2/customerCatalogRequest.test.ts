import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerCatalogForDevice } from "./customerCatalogRequest";

const device = { deviceId: "device-a", locationId: "location-a", organizationName: "Org", locationName: "Location" };

test("missing device credential cannot authenticate or load a customer catalog", async () => {
  let authenticated = false;
  let loaded = false;
  const result = await getCustomerCatalogForDevice(undefined, async () => { authenticated = true; return device; }, async () => { loaded = true; return []; });
  assert.equal(result.status, 401);
  assert.equal("locationId" in result.body, false);
  assert.equal(authenticated, false);
  assert.equal(loaded, false);
});

test("invalid device credential cannot load a customer catalog", async () => {
  let loaded = false;
  const result = await getCustomerCatalogForDevice("invalid", async () => null, async () => { loaded = true; return []; });
  assert.equal(result.status, 401);
  assert.equal("locationId" in result.body, false);
  assert.equal(loaded, false);
});

test("an authorized device loads only its Location catalog", async () => {
  const locations: string[] = [];
  const result = await getCustomerCatalogForDevice("valid", async () => device, async (locationId) => { locations.push(locationId); return ["channel"]; });
  assert.equal(result.status, 200);
  assert.deepEqual(locations, ["location-a"]);
  assert.equal(result.body.locationId, "location-a");
  assert.equal(result.body.deviceId, "device-a");
  assert.deepEqual(result.body.channels, ["channel"]);
});
