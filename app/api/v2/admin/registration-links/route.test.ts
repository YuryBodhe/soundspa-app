import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "./route";
import { PATCH } from "./[linkId]/route";

test("Registration Link listing requires operator authorization", async () => {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD };
  process.env.V2_ADMIN_USERNAME = "registration-test-operator";
  process.env.V2_ADMIN_PASSWORD = "registration-test-password";
  try {
    const response = await GET(new Request("https://soundspa.test/api/v2/admin/registration-links"));
    assert.equal(response.status, 401);
  } finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
  }
});

test("Registration Link disable requires authorization, same origin, and confirmation", async () => {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD, origin: process.env.V2_PUBLIC_ORIGIN };
  process.env.V2_ADMIN_USERNAME = "registration-test-operator";
  process.env.V2_ADMIN_PASSWORD = "registration-test-password";
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  const authorization = `Basic ${Buffer.from("registration-test-operator:registration-test-password").toString("base64")}`;
  const context = { params: Promise.resolve({ linkId: "8b832727-0a85-4db9-9f90-9dca381e0701" }) };
  try {
    const unauthenticated = await PATCH(new Request("https://soundspa.test", { method: "PATCH" }), context);
    assert.equal(unauthenticated.status, 401);
    const crossOrigin = await PATCH(new Request("https://soundspa.test", { method: "PATCH", headers: { Authorization: authorization, Origin: "https://attacker.test", "Content-Type": "application/json" }, body: "{}" }), context);
    assert.equal(crossOrigin.status, 403);
    const unconfirmed = await PATCH(new Request("https://soundspa.test", { method: "PATCH", headers: { Authorization: authorization, Origin: "https://soundspa.test", "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Reviewed disable request" }) }), context);
    assert.equal(unconfirmed.status, 400);
  } finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
    if (previous.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previous.origin;
  }
});

test("Registration Link creation requires operator authorization and same origin before parsing input", async () => {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD, origin: process.env.V2_PUBLIC_ORIGIN };
  process.env.V2_ADMIN_USERNAME = "registration-test-operator";
  process.env.V2_ADMIN_PASSWORD = "registration-test-password";
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  const authorization = `Basic ${Buffer.from("registration-test-operator:registration-test-password").toString("base64")}`;
  try {
    const unauthorized = await POST(new Request("https://soundspa.test/api/v2/admin/registration-links", { method: "POST", body: "{}" }));
    assert.equal(unauthorized.status, 401);
    const crossOrigin = await POST(new Request("https://soundspa.test/api/v2/admin/registration-links", {
      method: "POST", headers: { Authorization: authorization, Origin: "https://attacker.test", "Content-Type": "application/json" }, body: "{}",
    }));
    assert.equal(crossOrigin.status, 403);
    const invalidJson = await POST(new Request("https://soundspa.test/api/v2/admin/registration-links", {
      method: "POST", headers: { Authorization: authorization, Origin: "https://soundspa.test", "Content-Type": "application/json" }, body: "{",
    }));
    assert.equal(invalidJson.status, 400);
    assert.deepEqual(await invalidJson.json(), { ok: false, code: "invalid_json" });
    const invalidProducts = await POST(new Request("https://soundspa.test/api/v2/admin/registration-links", {
      method: "POST", headers: { Authorization: authorization, Origin: "https://soundspa.test", "Content-Type": "application/json" }, body: JSON.stringify({ products: [], reason: "Invalid empty product selection" }),
    }));
    assert.equal(invalidProducts.status, 400);
    assert.deepEqual(await invalidProducts.json(), { ok: false, code: "invalid_input" });
  } finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
    if (previous.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previous.origin;
  }
});
