import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsReportNotFoundError, type AnalyticsReportV1 } from "../../db/v2/analyticsReportModel";
import { handleAdminAnalyticsPost, parseAnalyticsReportRequest } from "./adminAnalyticsHttp";

const saved = {
  username: process.env.V2_ADMIN_USERNAME,
  password: process.env.V2_ADMIN_PASSWORD,
  origin: process.env.V2_PUBLIC_ORIGIN,
};
process.env.V2_ADMIN_USERNAME = "operator-test";
process.env.V2_ADMIN_PASSWORD = "test-password";
process.env.V2_PUBLIC_ORIGIN = "https://admin.example";
const authorization = `Basic ${Buffer.from("operator-test:test-password").toString("base64")}`;
const report = { metadata: { version: 1 } } as AnalyticsReportV1;

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://admin.example/api/v2/admin/analytics/report", {
    method: "POST",
    headers: { authorization, origin: "https://admin.example", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("strictly parses all, Organization and Location scopes with supported periods", () => {
  assert.deepEqual(parseAnalyticsReportRequest({ scope: { type: "all" }, period: "24h" }), { scope: { type: "all" }, period: "24h" });
  assert.deepEqual(parseAnalyticsReportRequest({ scope: { type: "organization", organizationId: "11111111-1111-4111-8111-111111111111" }, period: "7d" }), { scope: { type: "organization", organizationId: "11111111-1111-4111-8111-111111111111" }, period: "7d" });
  assert.deepEqual(parseAnalyticsReportRequest({ scope: { type: "location", locationId: "22222222-2222-4222-8222-222222222222" }, period: "1h" }), { scope: { type: "location", locationId: "22222222-2222-4222-8222-222222222222" }, period: "1h" });
  assert.throws(() => parseAnalyticsReportRequest({ scope: { type: "all" }, period: "5m" }));
  assert.throws(() => parseAnalyticsReportRequest({ scope: { type: "organization", organizationId: "not-a-uuid" }, period: "24h" }));
  assert.throws(() => parseAnalyticsReportRequest({ scope: { type: "all", organizationId: "extra" }, period: "24h" }));
});

test("unauthenticated request is rejected before parsing or querying", async () => {
  let calls = 0;
  const response = await handleAdminAnalyticsPost(new Request("https://admin.example/api/v2/admin/analytics/report", { method: "POST", body: "not-json" }), async () => { calls++; return report; });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 0);
});

test("same-origin protection rejects cross-origin POST before query", async () => {
  let calls = 0;
  const response = await handleAdminAnalyticsPost(request({ scope: { type: "all" }, period: "24h" }, { origin: "https://evil.example" }), async () => { calls++; return report; });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "same_origin_required");
  assert.equal(calls, 0);
});

test("non-JSON requests are rejected before query", async () => {
  let calls = 0;
  const response = await handleAdminAnalyticsPost(request({ scope: { type: "all" }, period: "24h" }, { "content-type": "text/plain" }), async () => { calls++; return report; });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "unsupported_media_type");
  assert.equal(calls, 0);
});

test("All, Organization and Location requests return canonical no-store reports without persistence", async () => {
  const calls: unknown[] = [];
  for (const scope of [
    { type: "all" },
    { type: "organization", organizationId: "11111111-1111-4111-8111-111111111111" },
    { type: "location", locationId: "22222222-2222-4222-8222-222222222222" },
  ]) {
    const response = await handleAdminAnalyticsPost(request({ scope, period: "24h" }), async (options) => { calls.push(options); return report; });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), report);
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((value) => (value as { scope: unknown }).scope), [
    { type: "all" },
    { type: "organization", organizationId: "11111111-1111-4111-8111-111111111111" },
    { type: "location", locationId: "22222222-2222-4222-8222-222222222222" },
  ]);
  // This handler exposes only the read-only canonical query dependency; it has no persistence/write path.
});

test("unknown scope entities return typed 404 and query failures are safely generic", async () => {
  const missingOrganization = await handleAdminAnalyticsPost(request({ scope: { type: "organization", organizationId: "11111111-1111-4111-8111-111111111111" }, period: "24h" }), async () => { throw new AnalyticsReportNotFoundError("ORGANIZATION_NOT_FOUND"); });
  assert.equal(missingOrganization.status, 404);
  assert.equal((await missingOrganization.json()).code, "organization_not_found");
  const missingLocation = await handleAdminAnalyticsPost(request({ scope: { type: "location", locationId: "22222222-2222-4222-8222-222222222222" }, period: "24h" }), async () => { throw new AnalyticsReportNotFoundError("LOCATION_NOT_FOUND"); });
  assert.equal(missingLocation.status, 404);
  assert.equal((await missingLocation.json()).code, "location_not_found");
  const failed = await handleAdminAnalyticsPost(request({ scope: { type: "all" }, period: "24h" }), async () => { throw new Error("private database detail"); });
  assert.equal(failed.status, 500);
  const body = await failed.text();
  assert.equal(body.includes("private database detail"), false);
  assert.equal(failed.headers.get("Cache-Control"), "no-store");
});

test("invalid request is a typed 400 and does not query", async () => {
  let calls = 0;
  const response = await handleAdminAnalyticsPost(request({ scope: { type: "all" }, period: "1m" }), async () => { calls++; return report; });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_request");
  assert.equal(calls, 0);
});

test.after(() => {
  for (const [key, value] of [["V2_ADMIN_USERNAME", saved.username], ["V2_ADMIN_PASSWORD", saved.password], ["V2_PUBLIC_ORIGIN", saved.origin]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
