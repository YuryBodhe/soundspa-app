import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterOrganizations, paginateOrganizations } from "./organizationDirectory";

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

test("Customers list is collapsed by default and reports location count in its heading", async () => {
  const source = await readFile(new URL("../../app/admin/ui/CustomersDirectory.tsx", import.meta.url), "utf8");
  assert.match(source, /<details className="admin-card admin-collapsible admin-customers-card">/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(source, /\{totalLocations\} Locations/);
  assert.match(source, /OrganizationContactEmailForm/);
  assert.match(source, /page, setPage/);
});
