import assert from "node:assert/strict";
import { isSameOriginMutation, operatorAuthStatus } from "../../lib/v2/adminOperator";
import { POST as createProductRoute } from "../../app/api/v2/admin/products/route";
import { PATCH as updateProductRoute } from "../../app/api/v2/admin/products/[productId]/route";

async function main() {
  const prior = {
    user: process.env.V2_ADMIN_USERNAME,
    password: process.env.V2_ADMIN_PASSWORD,
    origin: process.env.V2_PUBLIC_ORIGIN,
  };
  try {
  process.env.V2_ADMIN_USERNAME = "product-admin-test";
  process.env.V2_ADMIN_PASSWORD = "unit-only-password";
  process.env.V2_PUBLIC_ORIGIN = "https://v2-admin.test";

  assert.equal(operatorAuthStatus(null), 401);
  assert.equal(operatorAuthStatus(null), 401, "customer/session cookies do not replace operator Basic auth");
  assert.equal(operatorAuthStatus(`Basic ${Buffer.from("product-admin-test:unit-only-password").toString("base64")}`), 200);
  assert.equal(operatorAuthStatus(`Basic ${Buffer.from("customer:password").toString("base64")}`), 401);

  const customerOnlyRequest = () => new Request("https://v2-admin.test/api/v2/admin/products", {
    method: "POST",
    headers: { cookie: "soundspa_session=customer-session", origin: "https://v2-admin.test", "content-type": "application/json" },
    body: JSON.stringify({ name: "Should not be created", code: "customer-product", kind: "core", isActive: true, channelIds: [] }),
  });
  const createResponse = await createProductRoute(customerOnlyRequest());
  assert.equal(createResponse.status, 401, "customer session must not authorize Product creation");
  const updateResponse = await updateProductRoute(new Request("https://v2-admin.test/api/v2/admin/products/00000000-0000-4000-8000-000000000001", {
    method: "PATCH", headers: { cookie: "soundspa_session=customer-session", origin: "https://v2-admin.test", "content-type": "application/json" }, body: "{}",
  }), { params: Promise.resolve({ productId: "00000000-0000-4000-8000-000000000001" }) });
  assert.equal(updateResponse.status, 401, "customer session must not authorize Product changes");

  const operatorAuthorization = `Basic ${Buffer.from("product-admin-test:unit-only-password").toString("base64")}`;
  const codeMutationResponse = await updateProductRoute(new Request("https://v2-admin.test/api/v2/admin/products/00000000-0000-4000-8000-000000000001", {
    method: "PATCH",
    headers: { authorization: operatorAuthorization, origin: "https://v2-admin.test", "content-type": "application/json" },
    body: JSON.stringify({ name: "Changed", isActive: true, channelIds: [], code: "replacement-code" }),
  }), { params: Promise.resolve({ productId: "00000000-0000-4000-8000-000000000001" }) });
  assert.equal(codeMutationResponse.status, 400, "Product code cannot be changed through the Admin endpoint");

  assert.equal(isSameOriginMutation(new Request("https://internal:3000/api/v2/admin/products", {
    method: "POST", headers: { host: "v2-admin.test", origin: "https://v2-admin.test", "x-forwarded-proto": "https" },
  })), true);
  assert.equal(isSameOriginMutation(new Request("https://internal:3000/api/v2/admin/products", {
    method: "POST", headers: { host: "v2-admin.test", origin: "https://attacker.test", "x-forwarded-proto": "https" },
  })), false);
  console.info("Product Admin auth checks passed: operator authentication and same-origin mutation guard; no DB used.");
  } finally {
    if (prior.user === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = prior.user;
    if (prior.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = prior.password;
    if (prior.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = prior.origin;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
