import assert from "node:assert/strict";
import test from "node:test";
import { toCustomerPlayerChannels } from "./catalog";
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
