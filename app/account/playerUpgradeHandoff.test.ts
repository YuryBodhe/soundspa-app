import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlayerUpgradeWizardSelection, resolvePlayerUpgradeHandoff } from "./playerUpgradeHandoff";

const locations = [
  { id: "location-a", organizationId: "org-a", products: [
    { productId: "basic", purchaseEligible: true },
    { productId: "partner", purchaseEligible: true },
    { productId: "disabled", purchaseEligible: false },
  ] },
  { id: "location-b", organizationId: "org-a", products: [{ productId: "basic", purchaseEligible: true }] },
];

test("a single server-eligible Product is selected for its authorized Location", () => {
  const result = resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=location-a&productId=basic", locations);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.handoff.organizationId, "org-a");
  assert.deepEqual(result.handoff.selectedProductIds, ["basic"]);
  assert.deepEqual(result.handoff.eligibleProductIds, ["basic"]);
  assert.deepEqual(buildPlayerUpgradeWizardSelection(result.handoff), { "location-a": ["basic"] });
});

test("multiple eligible memberships are offered without selecting any for purchase", () => {
  const result = resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=location-a&productId=basic&productId=partner", locations);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.handoff.eligibleProductIds, ["basic", "partner"]);
  assert.deepEqual(result.handoff.selectedProductIds, []);
  assert.deepEqual(buildPlayerUpgradeWizardSelection(result.handoff), {});
});

test("unauthorized Locations and Products absent from purchase eligibility fail safely", () => {
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=other&productId=basic", locations), { status: "invalid_location" });
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=location-a&productId=disabled", locations), { status: "unavailable" });
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=location-a&productId=unknown", locations), { status: "unavailable" });
});

test("eligible Products survive mixed stale hints while unavailable hints are counted", () => {
  const result = resolvePlayerUpgradeHandoff("?source=player-upgrade&locationId=location-a&productId=basic&productId=disabled", locations);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.handoff.selectedProductIds, ["basic"]);
  assert.equal(result.handoff.unavailableProductCount, 1);
});

test("unrelated query strings do not request a player upgrade handoff", () => {
  assert.deepEqual(resolvePlayerUpgradeHandoff("?source=other&locationId=location-a&productId=basic", locations), { status: "not_requested" });
});

test("AccountClient validates handoff once after loading account billing and preserves normal login", async () => {
  const source = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  assert.match(source, /playerHandoffConsumedRef\.current = true/);
  assert.match(source, /resolvePlayerUpgradeHandoff\(window\.location\.search, billing\.locations\)/);
  assert.match(source, /if \(!account\) return/);
  assert.match(source, /playerHandoff\?\.organizationId === organizationId \? playerHandoff : undefined/);
});
