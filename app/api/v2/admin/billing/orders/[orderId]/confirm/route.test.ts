import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

const operator = "billing-confirm-route-test";
const password = "billing-confirm-route-test-password";
function request(options: { authorized?: boolean; origin?: string; body?: unknown }) {
  const headers = new Headers({ host: "soundspa.test", "x-forwarded-proto": "https", "content-type": "application/json" });
  if (options.authorized) headers.set("authorization", `Basic ${Buffer.from(`${operator}:${password}`).toString("base64")}`);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return new Request("https://soundspa.test/api/v2/admin/billing/orders/11111111-1111-4111-8111-111111111111/confirm", { method: "POST", headers, body: JSON.stringify(options.body ?? {}) });
}
async function withEnvironment(action: () => Promise<void>) {
  const old = [process.env.V2_ADMIN_USERNAME, process.env.V2_ADMIN_PASSWORD, process.env.V2_PUBLIC_ORIGIN];
  process.env.V2_ADMIN_USERNAME = operator; process.env.V2_ADMIN_PASSWORD = password; process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try { await action(); } finally {
    [process.env.V2_ADMIN_USERNAME, process.env.V2_ADMIN_PASSWORD, process.env.V2_PUBLIC_ORIGIN] = old;
  }
}

test("manual payment confirmation requires operator and same-origin requests before service access", async () => {
  await withEnvironment(async () => {
    const context = { params: Promise.resolve({ orderId: "11111111-1111-4111-8111-111111111111" }) };
    assert.equal((await POST(request({}), context)).status, 401);
    assert.equal((await POST(request({ authorized: true, origin: "https://attacker.test", body: {} }), context)).status, 403);
    const invalid = await POST(request({ authorized: true, origin: "https://soundspa.test", body: {
      amountMinor: "0", currency: "USD", bankTransactionReference: "", actualPaymentDate: "yesterday", reason: "no reason",
    } }), context);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "invalid_input");
  });
});
