import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterOrganizations, filterOrganizationsByStatus, groupOwnerLoginEmails, paginateOrganizations } from "./organizationDirectory";

const organizations = Array.from({ length: 45 }, (_, index) => ({
  id: `org-${index}`,
  name: index === 3 ? "Samui Wellness" : `Organization ${index}`,
  contactEmail: index === 31 ? "finance@samui.example" : null,
}));

test("organization search matches names and contact emails without case sensitivity", () => {
  assert.deepEqual(filterOrganizations(organizations, "SAMUI").map(({ id }) => id), ["org-3", "org-31"]);
  assert.equal(filterOrganizations(organizations, "unknown").length, 0);
  assert.equal(filterOrganizations(organizations, "  ").length, 45);
});

test("organization pagination defaults to 20 and clamps after filtering", () => {
  const first = paginateOrganizations(organizations, 1);
  const second = paginateOrganizations(organizations, 2);
  const last = paginateOrganizations(organizations, 99);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 20);
  assert.equal(last.page, 3);
  assert.equal(last.items.length, 5);
  assert.equal(paginateOrganizations([], 4).pageCount, 1);
});

test("owner login emails are grouped, distinct, sorted, and never fall back to contact email", () => {
  const owners = groupOwnerLoginEmails(["one-owner", "multiple-owners", "no-owner"], [
    { organizationId: "one-owner", email: "owner@example.test" },
    { organizationId: "multiple-owners", email: "z-owner@example.test" },
    { organizationId: "multiple-owners", email: "A-owner@example.test" },
    { organizationId: "multiple-owners", email: "a-owner@EXAMPLE.test" },
    { organizationId: "unknown-org", email: "ignored@example.test" },
  ]);
  assert.deepEqual(owners.get("one-owner"), ["owner@example.test"]);
  assert.deepEqual(owners.get("multiple-owners"), ["A-owner@example.test", "z-owner@example.test"]);
  assert.deepEqual(owners.get("no-owner"), []);

  const contactEmail = "billing@example.test";
  assert.notDeepEqual(owners.get("one-owner"), [contactEmail]);
  assert.deepEqual(owners.get("one-owner"), ["owner@example.test"]);
});

test("Organization status filtering defaults to active and can include archived or all", () => {
  const rows = [{ id: "active", archived: false }, { id: "archived", archived: true }];
  assert.deepEqual(filterOrganizationsByStatus(rows, "active").map(({ id }) => id), ["active"]);
  assert.deepEqual(filterOrganizationsByStatus(rows, "archived").map(({ id }) => id), ["archived"]);
  assert.equal(filterOrganizationsByStatus(rows, "all").length, 2);
});

test("Customers list is collapsed by default and reports location count in its heading", async () => {
  const source = await readFile(new URL("../../app/admin/ui/CustomersDirectory.tsx", import.meta.url), "utf8");
  const contactForm = await readFile(new URL("../../app/admin/ui/OrganizationContactEmailForm.tsx", import.meta.url), "utf8");
  assert.match(source, /<details className="admin-card admin-collapsible admin-customers-card">/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(source, /\{totalLocations\} Locations/);
  assert.match(source, /OrganizationContactEmailForm/);
  assert.match(source, /Owner login email:/);
  assert.match(source, /ownerLoginEmails/);
  assert.match(source, /No owner account linked/);
  assert.match(contactForm, /Contact email:/);
  assert.match(source, /page, setPage/);
  assert.match(source, /Organization status/);
  assert.match(source, /<option value="archived">Archived<\/option>/);
  assert.match(source, /OrganizationManagementPanel/);
});
