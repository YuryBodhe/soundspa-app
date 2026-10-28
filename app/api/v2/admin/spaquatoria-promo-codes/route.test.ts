import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[promoCodeId]/route";
import { POST as ARCHIVE } from "./[promoCodeId]/archive/route";
import { POST as RESTORE } from "./[promoCodeId]/restore/route";

test("Spaquatoria promo-code listing requires operator authorization", async () => {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD };
  process.env.V2_ADMIN_USERNAME = "promo-route-test-operator";
  process.env.V2_ADMIN_PASSWORD = "promo-route-test-password";
  try {
    const response = await GET(new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes"));
    assert.equal(response.status, 401);
  } finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
  }
});

test("Spaquatoria promo-code creation checks operator auth and same origin before parsing", async () => {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD, origin: process.env.V2_PUBLIC_ORIGIN };
  process.env.V2_ADMIN_USERNAME = "promo-route-test-operator";
  process.env.V2_ADMIN_PASSWORD = "promo-route-test-password";
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  const authorization = `Basic ${Buffer.from("promo-route-test-operator:promo-route-test-password").toString("base64")}`;
  try {
    const unauthorized = await POST(new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes", { method: "POST", body: "{}" }));
    assert.equal(unauthorized.status, 401);
    const crossOrigin = await POST(new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes", {
      method: "POST", headers: { Authorization: authorization, Origin: "https://attacker.test", "Content-Type": "application/json" }, body: "{}",
    }));
    assert.equal(crossOrigin.status, 403);
    const invalid = await POST(new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes", {
      method: "POST", headers: { Authorization: authorization, Origin: "https://soundspa.test", "Content-Type": "application/json" }, body: "{}",
    }));
    assert.equal(invalid.status, 400);
    const context = { params: Promise.resolve({ promoCodeId: "8b832727-0a85-4db9-9f90-9dca381e0701" }) };
    const crossOriginPatch = await PATCH(new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes/id", {
      method: "PATCH", headers: { Authorization: authorization, Origin: "https://attacker.test", "Content-Type": "application/json" }, body: "{}",
    }), context);
    assert.equal(crossOriginPatch.status, 403);
    const unauthorizedDelete = await DELETE(new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes/id", { method: "DELETE" }), context);
    assert.equal(unauthorizedDelete.status, 401);
  } finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
    if (previous.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previous.origin;
  }
});

test("promo archive and restore endpoints require operator auth and same-origin mutations", async () => {
  const previous = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD, origin: process.env.V2_PUBLIC_ORIGIN };
  process.env.V2_ADMIN_USERNAME = "promo-archive-route-test";
  process.env.V2_ADMIN_PASSWORD = "promo-archive-route-password";
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  const authorization = `Basic ${Buffer.from("promo-archive-route-test:promo-archive-route-password").toString("base64")}`;
  const validContext = { params: Promise.resolve({ promoCodeId: "8b832727-0a85-4db9-9f90-9dca381e0701" }) };
  const invalidContext = { params: Promise.resolve({ promoCodeId: "not-a-uuid" }) };
  const request = (origin: string, body: unknown) => new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes/id/archive", {
    method: "POST", headers: { Authorization: authorization, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await ARCHIVE(request("https://soundspa.test", {}), validContext)).status, 400, "archive requires a confirmed action and reason");
    assert.equal((await RESTORE(request("https://soundspa.test", { confirm: true, reason: "short" }), validContext)).status, 400,
      "restore validates request data before service access");
    assert.equal((await ARCHIVE(request("https://attacker.test", { confirm: true, reason: "Archive this campaign safely" }), validContext)).status, 403);
    assert.equal((await RESTORE(request("https://attacker.test", { confirm: true, reason: "Restore this campaign safely" }), validContext)).status, 403);
    assert.equal((await ARCHIVE(request("https://soundspa.test", { confirm: true, reason: "Archive this campaign safely" }), invalidContext)).status, 400);
    const noAuthorization = new Request("https://soundspa.test/api/v2/admin/spaquatoria-promo-codes/id/restore", { method: "POST", body: "{}" });
    assert.equal((await RESTORE(noAuthorization, validContext)).status, 401);
  } finally {
    if (previous.username === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
    if (previous.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previous.origin;
  }
});
