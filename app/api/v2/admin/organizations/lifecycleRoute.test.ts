import assert from "node:assert/strict";
import test from "node:test";
import { POST as ARCHIVE } from "./[organizationId]/archive/route";
import { POST as RESTORE } from "./[organizationId]/restore/route";


test("Organization lifecycle actions enforce operator auth and same-origin", async () => {
  const prior = { username: process.env.V2_ADMIN_USERNAME, password: process.env.V2_ADMIN_PASSWORD, origin: process.env.V2_PUBLIC_ORIGIN };
  process.env.V2_ADMIN_USERNAME = "lifecycle-route-test";
  process.env.V2_ADMIN_PASSWORD = "lifecycle-route-test-password";
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try {
    const context = { params: Promise.resolve({ organizationId: "invalid" }) };
    const request = (origin?: string, authorization?: string, body: unknown = { confirmationName: "Test Organization", reason: "Approved cleanup request" }) => new Request("https://soundspa.test/api", {
      method: "POST", headers: { ...(origin ? { Origin: origin } : {}), ...(authorization ? { Authorization: authorization } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const auth = `Basic ${Buffer.from("lifecycle-route-test:lifecycle-route-test-password").toString("base64")}`;
    assert.equal((await ARCHIVE(request("https://soundspa.test"), context)).status, 401);
    assert.equal((await ARCHIVE(request("https://evil.test", auth), context)).status, 403);
    assert.equal((await RESTORE(request("https://soundspa.test", auth, { confirmationName: "Test Organization", reason: "short" }), context)).status, 400);
    assert.equal((await ARCHIVE(request("https://soundspa.test", auth, { confirmationName: "Test Organization", reason: "Approved cleanup request", archivedAt: "trusted" }), context)).status, 400);
    assert.equal((await ARCHIVE(request("https://soundspa.test", auth), context)).status, 404);
  } finally {
    for (const [key, value] of Object.entries({ V2_ADMIN_USERNAME: prior.username, V2_ADMIN_PASSWORD: prior.password, V2_PUBLIC_ORIGIN: prior.origin })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
