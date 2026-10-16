import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { playerUpgradeAccountHref, toCustomerPlayerChannels } from "./catalog";
import type { CustomerCatalogChannel } from "@/lib/v2/customerCatalog";

const channel = (catalogProducts: Array<{ id: string; name: string }> | undefined): CustomerCatalogChannel => ({
  id: "channel-1",
  slug: "ambient",
  displayName: "Ambient",
  kind: "music",
  description: null,
  imageUrl: null,
  localizedTitles: {},
  playable: false,
  suspended: false,
  accessSources: [],
  accessExpiries: {},
  catalogProducts: catalogProducts ?? [],
  tracks: [],
});

test("customer player adapter preserves multiple Product memberships", () => {
  const products = [{ id: "basic", name: "SoundSpa Basic" }, { id: "partner", name: "Partner Product" }];
  assert.deepEqual(toCustomerPlayerChannels([channel(products)])[0].catalogProducts, products);
});

test("customer player adapter retains an empty Product list", () => {
  assert.deepEqual(toCustomerPlayerChannels([channel([])])[0].catalogProducts, []);
});

test("player upgrade links carry untrusted Location and distinct Product hints", () => {
  assert.equal(
    playerUpgradeAccountHref("location-1", ["basic", "partner", "basic"]),
    "/account?source=player-upgrade&locationId=location-1&productId=basic&productId=partner",
  );
  assert.equal(playerUpgradeAccountHref(undefined, ["basic"]), null);
  assert.equal(playerUpgradeAccountHref("location-1", []), "/account?source=player-upgrade&locationId=location-1");
});

test("locked-channel subscription action is a normal safe new-tab link", async () => {
  const source = await readFile(new URL("./V2Player.tsx", import.meta.url), "utf8");
  assert.match(source, /href=\{subscriptionHref\} target="_blank" rel="noopener noreferrer"/);
  assert.match(source, /playerUpgradeAccountHref\(locationId, lockedProductNames\.map/);
});
