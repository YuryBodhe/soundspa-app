import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("Spaquatoria promo redemption requires same origin and a verified customer session", async () => {
  const previousOrigin = process.env.V2_PUBLIC_ORIGIN;
  process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try {
  const crossOrigin = await POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-promos/redeem", {
    method: "POST", headers: { Origin: "https://attacker.test", "Content-Type": "application/json" }, body: JSON.stringify({ locationId: "550e8400-e29b-41d4-a716-446655440000", code: "x".repeat(32) }),
  }));
  assert.equal(crossOrigin.status, 403);
  const unauthenticated = await POST(new Request("https://soundspa.test/api/v2/customer/spaquatoria-promos/redeem", {
    method: "POST", headers: { Origin: "https://soundspa.test", "Content-Type": "application/json" }, body: JSON.stringify({ locationId: "550e8400-e29b-41d4-a716-446655440000", code: "x".repeat(32) }),
  }));
  assert.equal(unauthenticated.status, 401);
  } finally {
    if (previousOrigin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previousOrigin;
  }
});
