import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("Registration Link start rejects cross-origin requests before reading the token", async () => {
  const previousOrigin = process.env.V2_PUBLIC_ORIGIN;
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try {
    const response = await POST(new Request("https://soundspa.test/api/v2/customer-auth/registration-link/start", {
      method: "POST",
      headers: { Origin: "https://attacker.test", "Content-Type": "application/json" },
      body: JSON.stringify({ token: "x".repeat(43) }),
    }));
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /x{12}/);
  } finally {
    if (previousOrigin === undefined) delete process.env.V2_PUBLIC_ORIGIN;
    else process.env.V2_PUBLIC_ORIGIN = previousOrigin;
  }
});

test("Registration Link start rejects malformed tokens without reflecting them", async () => {
  const previousOrigin = process.env.V2_PUBLIC_ORIGIN;
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try {
    const token = "not-a-valid-registration-token";
    const response = await POST(new Request("https://soundspa.test/api/v2/customer-auth/registration-link/start", {
      method: "POST",
      headers: { Origin: "https://soundspa.test", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }));
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { ok: false, code: "registration_link_unavailable" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(body, new RegExp(token));
  } finally {
    if (previousOrigin === undefined) delete process.env.V2_PUBLIC_ORIGIN;
    else process.env.V2_PUBLIC_ORIGIN = previousOrigin;
  }
});
