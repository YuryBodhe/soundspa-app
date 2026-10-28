import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterPromoCodes } from "./promoArchiveFilter";

const codes = [
  { id: "active", archivedAt: null, status: "active" },
  { id: "expired", archivedAt: null, status: "expired" },
  { id: "archived", archivedAt: "2026-10-28T00:00:00.000Z", status: "active" },
];

test("promo archive filters preserve lifecycle status and return the expected groups", () => {
  assert.deepEqual(filterPromoCodes(codes, "not_archived").map(({ id }) => id), ["active", "expired"]);
  assert.deepEqual(filterPromoCodes(codes, "archived").map(({ id }) => id), ["archived"]);
  assert.deepEqual(filterPromoCodes(codes, "all").map(({ id }) => id), ["active", "expired", "archived"]);
  assert.equal(filterPromoCodes(codes, "archived")[0]?.status, "active", "archive state does not overwrite redemption lifecycle status");
});

test("Promo Codes uses the closed native admin disclosure and defaults to non-archived codes", async () => {
  const source = await readFile(new URL("./PromoCodeManagement.tsx", import.meta.url), "utf8");
  assert.match(source, /<details className="admin-card admin-collapsible admin-promo-codes-card">/);
  assert.match(source, /<summary className="admin-collapsible-summary"><span>Spaquatoria Promo Codes<\/span><span className="admin-customers-summary-meta">\{promoCodes\.length\} total/);
  assert.match(source, /useState<PromoArchiveFilter>\("not_archived"\)/);
  assert.match(source, /<option value="not_archived">Not archived<\/option>[\s\S]*<option value="archived">Archived<\/option>[\s\S]*<option value="all">All<\/option>/);
  assert.doesNotMatch(source, /<details className="admin-card admin-collapsible admin-promo-codes-card" open>/);
});
