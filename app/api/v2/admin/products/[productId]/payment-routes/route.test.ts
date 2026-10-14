import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "./route";
import { PATCH } from "./[routeId]/route";

const productId = "dfb9ee21-af86-4b68-97a0-9bbfa6e4a662";
const routeId = "fb0592fb-3d9c-45a7-9cb7-b712a699a9a3";

async function withOperatorEnvironment(operation: () => Promise<void>) {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD, origin: process.env.V2_PUBLIC_ORIGIN };
  process.env.V2_ADMIN_USERNAME = "route-test-operator";
  process.env.V2_ADMIN_PASSWORD = "temporary-route-test-password";
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try { await operation(); }
  finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
    if (previous.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previous.origin;
  }
}

function request(method: string, options: { authorized?: boolean; origin?: string; body?: unknown } = {}) {
  const headers = new Headers({ host: "soundspa.test", "x-forwarded-proto": "https", "content-type": "application/json" });
  if (options.authorized) headers.set("authorization", `Basic ${Buffer.from("route-test-operator:temporary-route-test-password").toString("base64")}`);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return new Request("https://soundspa.test/api/v2/admin/products/routes", {
    method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

test("payment route APIs reject unauthenticated reads and writes before database access", async () => {
  await withOperatorEnvironment(async () => {
    assert.equal((await GET(request("GET"), { params: Promise.resolve({ productId }) })).status, 401);
    assert.equal((await POST(request("POST", { body: {} }), { params: Promise.resolve({ productId }) })).status, 401);
    assert.equal((await PATCH(request("PATCH", { body: {} }), { params: Promise.resolve({ productId, routeId }) })).status, 401);
  });
});

test("payment route mutations require same-origin requests before reaching the service", async () => {
  await withOperatorEnvironment(async () => {
    const payload = { marketCode: "RU", providerCode: "fake-staging", externalReference: "route-test", displayOrder: 0, reason: "Reviewed staging route" };
    const post = await POST(request("POST", { authorized: true, origin: "https://attacker.test", body: payload }), { params: Promise.resolve({ productId }) });
    assert.equal(post.status, 403);
    const patch = await PATCH(request("PATCH", { authorized: true, origin: "https://attacker.test", body: { isEnabled: false, reason: "Reviewed route disable" } }), { params: Promise.resolve({ productId, routeId }) });
    assert.equal(patch.status, 403);
  });
});

test("route API rejects request-supplied audit identity fields", async () => {
  await withOperatorEnvironment(async () => {
    const response = await POST(request("POST", {
      authorized: true, origin: "https://soundspa.test",
      body: { marketCode: "RU", providerCode: "fake-staging", externalReference: "route-test", displayOrder: 0, reason: "Reviewed staging route", operator: "spoofed" },
    }), { params: Promise.resolve({ productId }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_input");
  });
});
