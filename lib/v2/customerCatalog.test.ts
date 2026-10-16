import assert from "node:assert/strict";
import test from "node:test";
import { filterCustomerCatalogChannels } from "./customerCatalogModel";
import type { CustomerCatalogProductPolicy } from "@/db/v2/queries/customerCatalogPolicy";

type CatalogItem = { id: string; accessSources: string[]; productAccessSources: Record<string, string[]>; playable: boolean; tracks: string[] };
const channel = (id: string, productAccessSources: Record<string, string[]> = {}, generic: string[] = []): CatalogItem => {
  const sources = [...Object.values(productAccessSources).flat(), ...generic];
  return { id, accessSources: sources, productAccessSources, playable: sources.length > 0, tracks: sources.length > 0 ? [`track-${id}`] : [] };
};
const policy = (input: {
  products?: Array<{ id: string; name?: string; visibility: "public" | "assigned"; channels: string[] }>;
  assigned?: string[];
} = {}): CustomerCatalogProductPolicy => ({
  productChannelIds: new Map((input.products ?? []).map((product) => [product.id, new Set(product.channels)])),
  productDisplayNames: new Map((input.products ?? []).map((product) => [product.id, product.name ?? product.id])),
  publicProductIds: new Set((input.products ?? []).filter((product) => product.visibility === "public").map(({ id }) => id)),
  assignedProductIds: new Set(input.assigned ?? []),
});
const ids = (items: CatalogItem[]) => items.map(({ id }) => id);

test("public Product channels appear without prior assignment and remain locked", () => {
  const result = filterCustomerCatalogChannels([channel("shared")], new Set(), policy({ products: [{ id: "new-product", name: "New Product", visibility: "public", channels: ["shared"] }] }));
  assert.deepEqual(ids(result), ["shared"]);
  assert.equal(result[0].playable, false);
  assert.deepEqual(result[0].tracks, []);
  assert.deepEqual(result[0].catalogProducts, [{ id: "new-product", name: "New Product" }]);
});

test("assigned Product stays hidden before assignment and appears after location history", () => {
  const product = { id: "assigned-product", visibility: "assigned" as const, channels: ["assigned-channel"] };
  const catalog = [channel("assigned-channel")];
  assert.deepEqual(filterCustomerCatalogChannels(catalog, new Set(), policy({ products: [product] })), []);
  const assigned = filterCustomerCatalogChannels(catalog, new Set(), policy({ products: [product], assigned: [product.id] }));
  assert.deepEqual(ids(assigned), ["assigned-channel"]);
  assert.equal(assigned[0].playable, false);
});

test("a single channel in overlapping Products is listed once and any active Product entitlement can play it", () => {
  const products = [
    { id: "public-basic", name: "SoundSpa Basic", visibility: "public" as const, channels: ["shared", "basic-only"] },
    { id: "assigned-partner", name: "Divnitsa", visibility: "assigned" as const, channels: ["shared", "partner-only"] },
  ];
  const result = filterCustomerCatalogChannels([
    channel("shared", { "assigned-partner": ["partner_benefit"] }),
    channel("basic-only", { "public-basic": ["trial"] }),
    channel("partner-only"),
  ], new Set(), policy({ products, assigned: ["assigned-partner"] }));
  assert.deepEqual(ids(result), ["shared", "basic-only", "partner-only"]);
  assert.equal(result.filter(({ id }) => id === "shared").length, 1);
  assert.equal(result.find(({ id }) => id === "shared")?.playable, true);
  assert.deepEqual(result.find(({ id }) => id === "shared")?.catalogProducts, [
    { id: "assigned-partner", name: "Divnitsa" },
    { id: "public-basic", name: "SoundSpa Basic" },
  ]);
});

test("locked channels include only customer-visible Product memberships in stable order", () => {
  const result = filterCustomerCatalogChannels(
    [channel("shared")],
    new Set(),
    policy({ products: [
      { id: "hidden-assigned", name: "Hidden Product", visibility: "assigned", channels: ["shared"] },
      { id: "public-z", name: "Zulu", visibility: "public", channels: ["shared"] },
      { id: "public-a", name: "Alpha", visibility: "public", channels: ["shared"] },
      { id: "public-tie-b", name: "Equal", visibility: "public", channels: ["shared"] },
      { id: "public-tie-a", name: "Equal", visibility: "public", channels: ["shared"] },
    ] }),
  );
  assert.equal(result[0].playable, false);
  assert.deepEqual(result[0].tracks, []);
  assert.deepEqual(result[0].catalogProducts, [
    { id: "public-a", name: "Alpha" },
    { id: "public-tie-a", name: "Equal" },
    { id: "public-tie-b", name: "Equal" },
    { id: "public-z", name: "Zulu" },
  ]);
});

test("expired entitlements preserve assigned catalog visibility but not playback", () => {
  const product = { id: "product", visibility: "assigned" as const, channels: ["channel"] };
  const result = filterCustomerCatalogChannels([channel("channel")], new Set(), policy({ products: [product], assigned: [product.id] }));
  assert.deepEqual(ids(result), ["channel"]);
  assert.equal(result[0].playable, false);
});

test("Organization assignment can apply to its Locations while Location-only history stays local", () => {
  const product = { id: "product", visibility: "assigned" as const, channels: ["channel"] };
  const catalog = [channel("channel")];
  const orgAssignedLocationA = policy({ products: [product], assigned: [product.id] });
  const orgAssignedLocationB = policy({ products: [product], assigned: [product.id] });
  assert.deepEqual(ids(filterCustomerCatalogChannels(catalog, new Set(), orgAssignedLocationA)), ["channel"]);
  assert.deepEqual(ids(filterCustomerCatalogChannels(catalog, new Set(), orgAssignedLocationB)), ["channel"]);
  const locationOnlyA = policy({ products: [product], assigned: [product.id] });
  const locationOnlyB = policy({ products: [product] });
  assert.deepEqual(ids(filterCustomerCatalogChannels(catalog, new Set(), locationOnlyA)), ["channel"]);
  assert.deepEqual(filterCustomerCatalogChannels(catalog, new Set(), locationOnlyB), []);
});

test("generic channel and admin grants do not bypass Product assignment or entitlement", () => {
  const assigned = { id: "assigned", visibility: "assigned" as const, channels: ["member"] };
  const noHistory = policy({ products: [assigned] });
  assert.deepEqual(filterCustomerCatalogChannels([channel("member", {}, ["admin"])], new Set(), noHistory), []);
  const visibleButLocked = filterCustomerCatalogChannels([channel("member", {}, ["admin"])], new Set(), policy({ products: [assigned], assigned: ["assigned"] }));
  assert.equal(visibleButLocked[0].playable, false);
  assert.deepEqual(visibleButLocked[0].accessSources, []);
});

test("a generic grant remains effective for a channel outside Product composition", () => {
  const result = filterCustomerCatalogChannels([channel("legacy-channel", {}, ["admin"])], new Set(), policy());
  assert.deepEqual(ids(result), ["legacy-channel"]);
  assert.equal(result[0].playable, true);
  assert.deepEqual(result[0].catalogProducts, []);
});

test("composition changes immediately determine current catalog candidates", () => {
  const before = policy({ products: [{ id: "product", visibility: "assigned", channels: ["channel"] }], assigned: ["product"] });
  const after = policy({ products: [{ id: "product", visibility: "assigned", channels: [] }], assigned: ["product"] });
  assert.deepEqual(ids(filterCustomerCatalogChannels([channel("channel")], new Set(), before)), ["channel"]);
  assert.deepEqual(filterCustomerCatalogChannels([channel("channel")], new Set(), after), []);
});

test("Location hidden override takes precedence over public Product access", () => {
  const result = filterCustomerCatalogChannels(
    [channel("channel", { public: ["trial"] })],
    new Set(["channel"]),
    policy({ products: [{ id: "public", visibility: "public", channels: ["channel"] }] }),
  );
  assert.deepEqual(result, []);
});

test("Product-bound channel requires Product-specific active access even when generic access is active", () => {
  const product = { id: "p", visibility: "public" as const, channels: ["channel"] };
  const result = filterCustomerCatalogChannels([channel("channel", {}, ["included", "admin"])], new Set(), policy({ products: [product] }));
  assert.equal(result[0].playable, false);
  assert.deepEqual(result[0].tracks, []);
});
