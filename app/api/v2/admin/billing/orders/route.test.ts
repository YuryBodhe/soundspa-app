import assert from "node:assert/strict";
import test from "node:test";
import { createManualBillingOrderSchema, POST } from "./route";

const operator = "billing-route-test";
const password = "billing-route-test-password";
function request(options: { authorized?: boolean; origin?: string; body?: unknown }) {
  const headers = new Headers({ host: "soundspa.test", "x-forwarded-proto": "https", "content-type": "application/json" });
  if (options.authorized) headers.set("authorization", `Basic ${Buffer.from(`${operator}:${password}`).toString("base64")}`);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return new Request("https://soundspa.test/api/v2/admin/billing/orders", { method: "POST", headers, body: JSON.stringify(options.body ?? {}) });
}
async function withEnvironment(action: () => Promise<void>) {
  const old = [process.env.V2_ADMIN_USERNAME, process.env.V2_ADMIN_PASSWORD, process.env.V2_PUBLIC_ORIGIN];
  process.env.V2_ADMIN_USERNAME = operator; process.env.V2_ADMIN_PASSWORD = password; process.env.V2_PUBLIC_ORIGIN = "https://soundspa.test";
  try { await action(); } finally {
    [process.env.V2_ADMIN_USERNAME, process.env.V2_ADMIN_PASSWORD, process.env.V2_PUBLIC_ORIGIN] = old;
  }
}

test("manual billing order creation enforces operator auth, same origin and strict request shape", async () => {
  await withEnvironment(async () => {
    assert.equal((await POST(request({}))).status, 401);
    assert.equal((await POST(request({ authorized: true, origin: "https://attacker.test", body: {} }))).status, 403);
    const invalid = await POST(request({ authorized: true, origin: "https://soundspa.test", body: {
      operator, organizationId: "not-a-uuid", lines: [], periodMonth: "2027-03", totalAmountMinor: "0", currency: "RUB",
      invoiceNumber: "", invoiceIssuedAt: "2027-02-01", paymentDueAt: "2027-02-05", reason: "short", idempotencyKey: "bad",
    } }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "invalid_input");
  });
});

test("manual invoice request accepts a single salon and exact non-calendar coverage", () => {
  const parsed = createManualBillingOrderSchema.safeParse({
    organizationId: "99999999-9999-4999-8999-999999999999",
    lines: [{ locationId: "11111111-1111-4111-8111-111111111111", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    periodStart: "2027-03-15", periodEndExclusive: "2027-04-10", totalAmountMinor: "1", currency: "RUB",
    invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24",
    reason: "Operator approved custom period", idempotencyKey: "invoice-2027-03-custom",
  });
  assert.equal(parsed.success, true);
  assert.equal(createManualBillingOrderSchema.safeParse({
    organizationId: "99999999-9999-4999-8999-999999999999", lines: [], periodStart: "2027-03-15", periodEndExclusive: "2027-04-10",
    totalAmountMinor: "1", currency: "RUB", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24",
    reason: "Operator approved custom period", idempotencyKey: "invoice-2027-03-custom",
  }).success, false);
});
