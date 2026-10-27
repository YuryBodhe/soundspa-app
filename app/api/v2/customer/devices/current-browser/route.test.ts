import assert from "node:assert/strict";
import test from "node:test";
import { CustomerDeviceAuthorizationError } from "@/lib/v2/customerDeviceAuthorization";
import { createPostHandler } from "./route";

const session = { user: { id: "customer-user", emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z") } };
const input = { operationId: "ab773c43-9d6c-42b0-b815-31a57042bc32", locationId: "6e991cee-d0be-4442-9dbc-f8e992d0aef1", deviceName: "Front desk browser" };

function request(options: { origin?: string; token?: string; body?: unknown; rawBody?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", host: "soundspa.test" });
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.token !== undefined) headers.set("cookie", `soundspa_v2_customer=${encodeURIComponent(options.token)}`);
  return new Request("https://soundspa.test/api/v2/customer/devices/current-browser", {
    method: "POST", headers, body: options.rawBody ?? JSON.stringify(options.body ?? input),
  });
}

test("current browser activation rejects cross-origin calls before session or device creation", async () => {
  let lookups = 0;
  let creates = 0;
  const post = createPostHandler({
    sameOrigin: (candidate) => candidate.headers.get("origin") === "https://soundspa.test",
    getSession: async () => { lookups++; return session; },
    createDevice: async () => { creates++; return { device: { label: input.deviceName }, credential: "C".repeat(43) }; },
  });
  const response = await post(request({ origin: "https://attacker.test", token: "valid" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "request_not_allowed" });
  assert.equal(lookups, 0);
  assert.equal(creates, 0);
});

test("current browser activation requires an authenticated verified customer", async () => {
  let creates = 0;
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async (token) => token === "valid" ? session : token === "unverified"
      ? { user: { id: session.user.id, emailVerifiedAt: null } } : null,
    createDevice: async () => { creates++; return { device: { label: input.deviceName }, credential: "C".repeat(43) }; },
  });
  assert.equal((await post(request({ origin: "https://soundspa.test" }))).status, 401);
  assert.equal((await post(request({ origin: "https://soundspa.test", token: "missing" }))).status, 401);
  const unverified = await post(request({ origin: "https://soundspa.test", token: "unverified" }));
  assert.equal(unverified.status, 403);
  assert.deepEqual(await unverified.json(), { error: "unverified" });
  assert.equal(creates, 0);
});

test("current browser activation validates input and forwards only the authenticated user and selected Location", async () => {
  let received: unknown;
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    createDevice: async (value) => { received = value; return { device: { label: value.name }, credential: "C".repeat(43) }; },
  });
  const invalid = await post(request({ token: "valid", origin: "https://soundspa.test", body: { ...input, locationId: "not-a-uuid" } }));
  assert.equal(invalid.status, 400);
  const tooLarge = await post(request({ token: "valid", origin: "https://soundspa.test", rawBody: "x".repeat(4097) }));
  assert.equal(tooLarge.status, 400);
  assert.equal(received, undefined);

  const response = await post(request({ token: "valid", origin: "https://soundspa.test" }));
  assert.equal(response.status, 201);
  assert.deepEqual(received, { authenticatedUserId: session.user.id, operationId: input.operationId, locationId: input.locationId, name: input.deviceName });
  assert.deepEqual(await response.json(), { device: { label: input.deviceName } }, "raw Device credential must not be returned in JSON");
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /soundspa_v2_device=C{43}/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=31536000/i);
});

test("unauthorized Location failures are generic and do not issue a Device cookie", async () => {
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    createDevice: async () => { throw new CustomerDeviceAuthorizationError("location_unavailable"); },
  });
  const response = await post(request({ token: "valid", origin: "https://soundspa.test" }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "location_unavailable" });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("expired idempotency operations fail closed without issuing a Device cookie", async () => {
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    createDevice: async () => { throw Object.assign(new Error("expired"), { name: "DeviceProvisioningError", code: "operation_expired" }); },
  });
  const response = await post(request({ token: "valid", origin: "https://soundspa.test" }));
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: "operation_expired" });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("missing idempotency secret surfaces only an unavailable response", async () => {
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    createDevice: async () => { throw Object.assign(new Error("configuration unavailable"), { name: "DeviceProvisioningError", code: "configuration_unavailable" }); },
  });
  const response = await post(request({ token: "valid", origin: "https://soundspa.test" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
  assert.equal(response.headers.get("set-cookie"), null);
});
