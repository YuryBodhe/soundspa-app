import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adminLocationPath } from "./adminLocationNavigation";

test("location management uses the dedicated, encoded Location route", () => {
  assert.equal(adminLocationPath("9c6e0da0-c6d2-4f53-b1c6-ccf69ef48bb2"), "/admin/ui/locations/9c6e0da0-c6d2-4f53-b1c6-ccf69ef48bb2");
  assert.equal(adminLocationPath("id/with spaces"), "/admin/ui/locations/id%2Fwith%20spaces");
});

test("admin dashboard keeps the overview visible and its three data sections collapsed", async () => {
  const source = await readFile(new URL("../../app/admin/ui/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<details className="admin-card admin-collapsible">\s*<summary[^>]*><span>Products<\/span>/);
  assert.match(source, /<details className="admin-card admin-collapsible">\s*<summary[^>]*><span>Partners<\/span>/);
  assert.match(source, /<details className="admin-card admin-collapsible">\s*<summary[^>]*><span>SoundSpa Basic channel composition<\/span>/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(source, /admin-customers-card/);
});

test("dedicated Location route keeps operator authorization and a Customers return path", async () => {
  const source = await readFile(new URL("../../app/admin/ui/locations/[locationId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /operatorAuthStatus\(/);
  assert.match(source, /if \(!UUID\.test\(locationId\)\) notFound\(\)/);
  assert.match(source, /eq\(locations\.id, locationId\)/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /href="\/admin\/ui"[^>]*>Back to Customers/);
});
