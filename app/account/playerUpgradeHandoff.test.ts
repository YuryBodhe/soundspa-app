import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlayerUpgradeWizardSelection, resolvePlayerUpgradeHandoff } from "./playerUpgradeHandoff";

const locations = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organizationId: "org-a", products: [
    { productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", purchaseEligible: true },
    { productId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", purchaseEligible: true },
    { productId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", purchaseEligible: false },
  ] },
  { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", organizationId: "org-a", products: [{ productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", purchaseEligible: true }] },
];

test("a single server-eligible Product is selected for its authorized Location", () => {
  const result = resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&productId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", locations);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.handoff.organizationId, "org-a");
  assert.deepEqual(result.handoff.selectedProductIds, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  assert.deepEqual(result.handoff.eligibleProductIds, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  assert.deepEqual(buildPlayerUpgradeWizardSelection(result.handoff), { "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] });
});

test("multiple eligible memberships are offered without selecting any for purchase", () => {
  const result = resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&productId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&productId=cccccccc-cccc-4ccc-8ccc-cccccccccccc", locations);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.handoff.eligibleProductIds, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  assert.deepEqual(result.handoff.selectedProductIds, []);
  assert.deepEqual(buildPlayerUpgradeWizardSelection(result.handoff), {});
});

test("unauthorized Locations and Products absent from purchase eligibility fail safely", () => {
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=ffffffff-ffff-4fff-8fff-ffffffffffff&productId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", locations), { status: "invalid_location" });
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&productId=dddddddd-dddd-4ddd-8ddd-dddddddddddd", locations), { status: "unavailable" });
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&productId=ffffffff-ffff-4fff-8fff-ffffffffffff", locations), { status: "unavailable" });
});

test("eligible Products survive mixed stale hints while unavailable hints are counted", () => {
  const result = resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&productId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&productId=dddddddd-dddd-4ddd-8ddd-dddddddddddd", locations);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.handoff.selectedProductIds, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  assert.equal(result.handoff.unavailableProductCount, 1);
});

test("unrelated query strings do not request a player upgrade handoff", () => {
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=other&locationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&productId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", locations), { status: "not_requested" });
});

test("AccountClient validates handoff once after loading account billing and preserves normal login", async () => {
  const source = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  assert.match(source, /playerHandoffConsumedRef\.current = true/);
  assert.match(source, /resolvePlayerUpgradeHandoff\(currentSearch, billing\.locations\)/);
  assert.match(source, /if \(!account\) return/);
  assert.match(source, /playerUpgradeLoginPath\(window\.location\.search\)/);
  assert.match(source, /removePlayerUpgradeContextParams\(currentSearch\)/);
  assert.match(source, /playerHandoff\?\.organizationId === organizationId \? playerHandoff : undefined/);
  assert.ok(source.indexOf("if (!account) return") < source.indexOf("removePlayerUpgradeContextParams(currentSearch)"));
});
