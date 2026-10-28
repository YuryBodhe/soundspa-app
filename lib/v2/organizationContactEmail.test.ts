import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ContactEmailValidationError, normalizeContactEmail } from "./contactEmail";
import { updateOrganizationContactEmail } from "../../db/v2/services/organizationContactEmail";

test("contact email is optional, trimmed, and format-validated", () => {
  assert.equal(normalizeContactEmail(undefined), null);
  assert.equal(normalizeContactEmail("  "), null);
  assert.equal(normalizeContactEmail("  billing@example.com  "), "billing@example.com");
  assert.throws(() => normalizeContactEmail("bad address"), ContactEmailValidationError);
  assert.throws(() => normalizeContactEmail(`${"a".repeat(250)}@example.com`), ContactEmailValidationError);
});

test("organization contact email update persists only the normalized requested value", async () => {
  const calls: Array<{ id: string; email: string | null }> = [];
  const result = await updateOrganizationContactEmail("org-1", " contact@example.com ", async (id, email) => {
    calls.push({ id, email });
    return { id, contactEmail: email };
  });
  assert.deepEqual(calls, [{ id: "org-1", email: "contact@example.com" }]);
  assert.deepEqual(result, { id: "org-1", contactEmail: "contact@example.com" });

  let invalidWriteCalled = false;
  await assert.rejects(updateOrganizationContactEmail("org-1", "not-an-email", async () => {
    invalidWriteCalled = true;
    return null;
  }), (error: { code?: string }) => error.code === "validation");
  assert.equal(invalidWriteCalled, false);
  await assert.rejects(updateOrganizationContactEmail("missing-org", "", async () => null), (error: { code?: string }) => error.code === "not_found");
  const service = await readFile(new URL("../../db/v2/services/organizationContactEmail.ts", import.meta.url), "utf8");
  assert.match(service, /set\(\{ contactEmail: email, updatedAt: new Date\(\) \}\)/);
  assert.match(service, /where\(eq\(organizations\.id, id\)\)/);
});

test("organization update route enforces operator and same-origin authorization before updating", async () => {
  const route = await readFile(new URL("../../app/api/v2/admin/organizations/[organizationId]/route.ts", import.meta.url), "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH"), route.indexOf("export async function DELETE"));
  assert.ok(patch.indexOf("operatorAuthStatus") < patch.indexOf("request.json"));
  assert.ok(patch.indexOf("isSameOriginMutation") < patch.indexOf("request.json"));
  assert.match(patch, /Object\.prototype\.hasOwnProperty\.call\(body, "contactEmail"\)/);
  assert.match(patch, /updateOrganizationContactEmail\(organizationId, \(body as \{ contactEmail: unknown \}\)\.contactEmail\)/);
});

test("new customer form submits optional contact email without touching login identity", async () => {
  const form = await readFile(new URL("../../app/admin/ui/customerProvisioningForm.tsx", import.meta.url), "utf8");
  const service = await readFile(new URL("../../db/v2/services/customerProvisioning.ts", import.meta.url), "utf8");
  assert.match(form, /name="contactEmail" type="email"/);
  assert.match(form, /contactEmail: contactEmail \|\| null/);
  assert.match(service, /values\(\{ name: input\.organizationName, contactEmail: input\.contactEmail \}\)/);
  assert.doesNotMatch(service, /users\.email|customerAuth/);
});
