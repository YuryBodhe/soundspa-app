import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  billingMarketSelectionState,
  billingOrderErrorKey,
  billingOrderStatusKey,
  canResumeBillingOrder,
  canPreviewBillingLines,
  saveBillingMarketAndRefresh,
} from "./billingWizardModel";

test("a persisted RU market is immediately treated as saved", () => {
  assert.equal(billingMarketSelectionState({ persistedMarket: "RU", selectedMarket: "", saving: false, error: "" }), "saved");
  assert.equal(canPreviewBillingLines([{ marketCode: "RU" }]), true);
});

test("a missing market requires selection, save, and authoritative refresh before preview", async () => {
  const events: string[] = [];
  assert.equal(billingMarketSelectionState({ persistedMarket: null, selectedMarket: "", saving: false, error: "" }), "missing");
  assert.equal(billingMarketSelectionState({ persistedMarket: null, selectedMarket: "RU", saving: false, error: "" }), "unsaved");
  assert.equal(canPreviewBillingLines([{ marketCode: null }]), false);
  const updated = await saveBillingMarketAndRefresh({
    locationId: "location-1",
    marketCode: "RU",
    save: async () => { events.push("save"); },
    refresh: async () => { events.push("refresh"); return [{ id: "location-1", marketCode: "RU" }]; },
  });
  assert.deepEqual(events, ["save", "refresh"]);
  assert.equal(updated.marketCode, "RU");
  assert.equal(canPreviewBillingLines([{ marketCode: updated.marketCode }]), true);
});

test("save failure is surfaced and does not refresh billing data", async () => {
  let refreshed = false;
  await assert.rejects(saveBillingMarketAndRefresh({
    locationId: "location-1",
    marketCode: "RU",
    save: async () => { throw new Error("market_unavailable"); },
    refresh: async () => { refreshed = true; return []; },
  }), /market_unavailable/);
  assert.equal(refreshed, false);
  assert.equal(billingMarketSelectionState({ persistedMarket: null, selectedMarket: "RU", saving: false, error: "market_unavailable" }), "error");
});

test("successful save followed by stale billing data cannot unlock preview", async () => {
  await assert.rejects(saveBillingMarketAndRefresh({
    locationId: "location-1",
    marketCode: "RU",
    save: async () => {},
    refresh: async () => [{ id: "location-1", marketCode: null }],
  }), /market_refresh_failed/);
  assert.equal(canPreviewBillingLines([{ marketCode: null }]), false);
});

test("compatible multi-Location markets can preview and use the shared server quote flow", () => {
  assert.equal(canPreviewBillingLines([{ marketCode: "RU" }, { marketCode: "RU" }]), true);
  // Market compatibility is determined by the server's route and pricing planner.
  assert.equal(canPreviewBillingLines([{ marketCode: "RU" }, { marketCode: "VN" }]), true);
  assert.equal(canPreviewBillingLines([{ marketCode: "RU" }, { marketCode: null }]), false);
});

test("multi-Location route, pricing, and provider incompatibilities receive specific messages", () => {
  assert.equal(billingOrderErrorKey("incompatible_routes", 2), "billingWizardIncompatibleRoutes");
  assert.equal(billingOrderErrorKey("unsupported_pricing", 2), "billingWizardMultiLocationPricingUnavailable");
  assert.equal(billingOrderErrorKey("route_unavailable", 2), "billingWizardMultiLocationRouteUnavailable");
  assert.equal(billingOrderErrorKey("provider_not_configured", 2), "billingProviderUnavailable");
});

test("single-Location billing route and pricing errors retain their existing messages", () => {
  assert.equal(billingOrderErrorKey("route_unavailable", 1), "billingNoRoutes");
  assert.equal(billingOrderErrorKey("unsupported_pricing", 1), "billingPaymentFailed");
  assert.equal(billingOrderErrorKey("market_not_configured", 1), "billingMarketMissing");
});

test("only authoritative pending orders can be resumed and every order status is localized", () => {
  assert.equal(canResumeBillingOrder("pending"), true);
  for (const status of ["paid", "expired", "canceled", "failed", "draft", "quoted"]) assert.equal(canResumeBillingOrder(status), false);
  assert.equal(billingOrderStatusKey("paid"), "billingOrderPaid");
  assert.equal(billingOrderStatusKey("pending"), "billingOrderPending");
  assert.equal(billingOrderStatusKey("expired"), "billingOrderExpiredStatus");
  assert.equal(billingOrderStatusKey("canceled"), "billingOrderAbandoned");
  assert.equal(billingOrderStatusKey("failed"), "billingOrderFailed");
});

test("recovery UI reads Account history, resumes through the authorized checkout route, and exposes status retry", async () => {
  const source = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  assert.match(source, /billing\/orders\/\$\{encodeURIComponent\(historyOrder\.id\)\}\/fake-checkout/);
  assert.match(source, /billingWizardRefreshStatus/);
  assert.match(source, /billingWizardStatusRefreshFailed/);
  assert.match(source, /billingOrdersContinue/);
  assert.match(source, /billingPaidStarts/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("the wizard renders its request error in only one place", async () => {
  const source = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/\{error\s*&&/g) ?? []).length, 1);
});
