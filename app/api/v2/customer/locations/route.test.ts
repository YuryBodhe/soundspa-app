import assert from "node:assert/strict";
import test from "node:test";
import { createPostHandler } from "./route";

const session = { user: { id: "owner-1", emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z") } };
const payload = { organizationId: "6e991cee-d0be-4442-9dbc-f8e992d0aef1", name: "North Salon", timezone: "Europe/Moscow" };

function request(options: { origin?: string; token?: string; body?: unknown } = {}) {
  const headers = new Headers({ "content-type": "application/json", host: "soundspa.test" });
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.token !== undefined) headers.set("cookie", `soundspa_v2_customer=${encodeURIComponent(options.token)}`);
  return new Request("https://soundspa.test/api/v2/customer/locations", {
    method: "POST", headers, body: JSON.stringify(options.body ?? payload),
  });
}

test("Location route rejects cross-origin requests before session or creation lookup", async () => {
  let sessionLookups = 0;
  let createCalls = 0;
  const post = createPostHandler({
    sameOrigin: (candidate) => candidate.headers.get("origin") === "https://soundspa.test",
    getSession: async () => { sessionLookups++; return session; },
    createLocation: async () => { createCalls++; return { id: "location-1", name: "North Salon", slug: "north-salon-a1", timezone: "UTC" }; },
  });
  const response = await post(request({ origin: "https://attacker.test", token: "session" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "request_not_allowed" });
  assert.equal(sessionLookups, 0);
  assert.equal(createCalls, 0);
});

test("Location route requires a session and verified email", async () => {
  let createCalls = 0;
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async (token) => token === "valid" ? session : null,
    createLocation: async () => { createCalls++; return { id: "location-1", name: "North Salon", slug: "north-salon-a1", timezone: "UTC" }; },
  });
  const missing = await post(request({}));
  assert.equal(missing.status, 401);
  const noSession = await post(request({ token: "invalid" }));
  assert.equal(noSession.status, 401);

  const unverified = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => ({ user: { id: "owner-1", emailVerifiedAt: null } }),
    createLocation: async () => { createCalls++; return { id: "location-1", name: "North Salon", slug: "north-salon-a1", timezone: "UTC" }; },
  });
  const unverifiedResponse = await unverified(request({ token: "valid" }));
  assert.equal(unverifiedResponse.status, 403);
  assert.deepEqual(await unverifiedResponse.json(), { error: "unverified" });
  assert.equal(createCalls, 0);
});

test("Location route passes the session user and requested Organization to the service", async () => {
  let received: unknown;
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async (token) => token === "owner-session" ? session : null,
    createLocation: async (input) => {
      received = input;
      return { id: "location-1", name: input.name, slug: "north-salon-a1", timezone: input.timezone };
    },
  });
  const response = await post(request({ origin: "https://soundspa.test", token: "owner-session" }));
  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    authenticatedUserId: "owner-1", organizationId: payload.organizationId, name: payload.name, timezone: payload.timezone,
  });
  assert.equal((await response.json() as { location: { id: string } }).location.id, "location-1");
});

test("Location route maps service Owner and duplicate errors to safe client statuses", async () => {
  const post = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    createLocation: async () => { throw Object.assign(new Error("internal detail"), { name: "CustomerLocationError", code: "owner_required" }); },
  });
  const response = await post(request({ token: "owner-session" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "owner_required" });

  const duplicate = createPostHandler({
    sameOrigin: () => true,
    getSession: async () => session,
    createLocation: async () => { throw Object.assign(new Error("internal detail"), { name: "CustomerLocationError", code: "duplicate_name" }); },
  });
  const duplicateResponse = await duplicate(request({ token: "owner-session" }));
  assert.equal(duplicateResponse.status, 409);
  assert.deepEqual(await duplicateResponse.json(), { error: "duplicate_name" });
});
