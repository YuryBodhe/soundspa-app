import assert from "node:assert/strict";
import { operatorAuthStatus } from "../../lib/v2/adminOperator";
import { PATCH as updateVisibility } from "../../app/api/v2/admin/products/[productId]/visibility/route";
import { GET as listAuthorizations, POST as grantAuthorization } from "../../app/api/v2/admin/products/[productId]/authorizations/route";
import { PATCH as revokeAuthorization } from "../../app/api/v2/admin/products/[productId]/authorizations/[authorizationId]/route";
import { DELETE as deleteOrganization } from "../../app/api/v2/admin/organizations/[organizationId]/route";

async function main() {
  const previous = {
    user: process.env.V2_ADMIN_USERNAME,
    password: process.env.V2_ADMIN_PASSWORD,
    origin: process.env.V2_PUBLIC_ORIGIN,
  };
  process.env.V2_ADMIN_USERNAME = "visibility-operator-test";
  process.env.V2_ADMIN_PASSWORD = "unit-only-operator-secret";
  process.env.V2_PUBLIC_ORIGIN = "https://v2-operator.test";
  const authorization = `Basic ${Buffer.from("visibility-operator-test:unit-only-operator-secret").toString("base64")}`;
  const params = { productId: "00000000-0000-4000-8000-000000000001", authorizationId: "00000000-0000-4000-8000-000000000002" };
  const context = { params: Promise.resolve(params) };

  try {
    assert.equal(operatorAuthStatus(null), 401);
    assert.equal(operatorAuthStatus(`Basic ${Buffer.from("customer:password").toString("base64")}`), 401);
    assert.equal(operatorAuthStatus(authorization), 200);

    const customerRequest = (url: string, method: string) => new Request(url, {
      method,
      headers: { cookie: "soundspa_customer=session", origin: "https://v2-operator.test", "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    assert.equal((await updateVisibility(customerRequest("https://v2-operator.test/api", "PATCH"), context)).status, 401);
    assert.equal((await listAuthorizations(customerRequest("https://v2-operator.test/api", "GET"), context)).status, 401);
    assert.equal((await grantAuthorization(customerRequest("https://v2-operator.test/api", "POST"), context)).status, 401);
    assert.equal((await revokeAuthorization(customerRequest("https://v2-operator.test/api", "PATCH"), context)).status, 401);
    assert.equal((await deleteOrganization(customerRequest("https://v2-operator.test/api", "DELETE"), { params: Promise.resolve({ organizationId: params.productId }) })).status, 401);

    const badOrigin = (method: string) => new Request("https://v2-operator.test/api", {
      method, headers: { authorization, origin: "https://attacker.test", "content-type": "application/json" }, body: "{}",
    });
    assert.equal((await updateVisibility(badOrigin("PATCH"), context)).status, 403);
    assert.equal((await grantAuthorization(badOrigin("POST"), context)).status, 403);
    assert.equal((await revokeAuthorization(badOrigin("PATCH"), context)).status, 403);

    const malformedVisibility = await updateVisibility(new Request("https://v2-operator.test/api", {
      method: "PATCH", headers: { authorization, origin: "https://v2-operator.test", "content-type": "application/json" },
      body: JSON.stringify({ visibility: "hidden", reason: "Operator test reason", confirmed: true }),
    }), context);
    assert.equal(malformedVisibility.status, 400);
    const unconfirmedVisibility = await updateVisibility(new Request("https://v2-operator.test/api", {
      method: "PATCH", headers: { authorization, origin: "https://v2-operator.test", "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private", reason: "Operator test reason", confirmed: false }),
    }), context);
    assert.equal(unconfirmedVisibility.status, 400);

    const unconfirmedRevoke = await revokeAuthorization(new Request("https://v2-operator.test/api", {
      method: "PATCH", headers: { authorization, origin: "https://v2-operator.test", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Operator test reason", confirmed: false }),
    }), context);
    assert.equal(unconfirmedRevoke.status, 400);
    console.info("Product Visibility Admin route checks PASS: operator-only access, same-origin mutations, validation, explicit confirmation, and customer-role rejection.");
  } finally {
    if (previous.user === undefined) delete process.env.V2_ADMIN_USERNAME; else process.env.V2_ADMIN_USERNAME = previous.user;
    if (previous.password === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = previous.password;
    if (previous.origin === undefined) delete process.env.V2_PUBLIC_ORIGIN; else process.env.V2_PUBLIC_ORIGIN = previous.origin;
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
