import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminMonitoringGet } from "./adminMonitoringHttp";
import type { MonitoringSnapshotV1 } from "../../db/v2/monitoringSnapshotModel";

const savedUsername = process.env.V2_ADMIN_USERNAME;
const savedPassword = process.env.V2_ADMIN_PASSWORD;
process.env.V2_ADMIN_USERNAME = "operator-test";
process.env.V2_ADMIN_PASSWORD = "test-password";

const snapshot: MonitoringSnapshotV1 = {
  asOf: "2026-10-02T13:15:00.000Z", onlineThresholdSeconds: 300,
  summary: { organizationCount: 0, locationCount: 0, deviceCount: 0, onlineDeviceCount: 0, playingDeviceCount: 0 },
  organizations: [],
};
const authorization = `Basic ${Buffer.from("operator-test:test-password").toString("base64")}`;

test("Admin monitoring API rejects unauthorized GET and does not query state", async () => {
  let queries = 0;
  const response = await handleAdminMonitoringGet(new Request("https://test.example/api/v2/admin/monitoring"), async () => {
    queries++;
    return snapshot;
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(queries, 0);
});

test("authorized Admin monitoring response is no-store and contains only the canonical snapshot", async () => {
  const response = await handleAdminMonitoringGet(new Request("https://test.example/api/v2/admin/monitoring", { headers: { authorization } }), async () => snapshot);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), snapshot);
});

test("missing operator credentials fail closed", () => {
  const previousUsername = process.env.V2_ADMIN_USERNAME;
  const previousPassword = process.env.V2_ADMIN_PASSWORD;
  delete process.env.V2_ADMIN_USERNAME;
  delete process.env.V2_ADMIN_PASSWORD;
  return handleAdminMonitoringGet(new Request("https://test.example/api/v2/admin/monitoring"), async () => snapshot)
    .then((response) => assert.equal(response.status, 503))
    .finally(() => {
      process.env.V2_ADMIN_USERNAME = previousUsername;
      process.env.V2_ADMIN_PASSWORD = previousPassword;
    });
});

test.after(() => {
  if (savedUsername === undefined) delete process.env.V2_ADMIN_USERNAME;
  else process.env.V2_ADMIN_USERNAME = savedUsername;
  if (savedPassword === undefined) delete process.env.V2_ADMIN_PASSWORD;
  else process.env.V2_ADMIN_PASSWORD = savedPassword;
});
