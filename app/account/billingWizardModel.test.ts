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
  formatBillingPeriodRange,
  billingLineKey,
  buildSelectedBillingLines,
  toggleBillingProductSelection,
  restoreBillingOrderSelection,
  billingOrderRequestPayload,
} from "./billingWizardModel";

test("server period estimates render in the selected language using UTC calendar dates", () => {
  const startsAt = "2026-11-06T15:16:28.704Z";
  const endsAt = "2026-12-06T15:16:28.704Z";
  assert.equal(formatBillingPeriodRange(startsAt, endsAt, "en"), "Nov 6, 2026 – Dec 6, 2026");
  assert.match(formatBillingPeriodRange(startsAt, endsAt, "ru") ?? "", /6 нояб\. 2026 г\./);
  assert.match(formatBillingPeriodRange(startsAt, endsAt, "vi") ?? "", /6 thg 11, 2026/);
  assert.match(formatBillingPeriodRange(startsAt, endsAt, "th") ?? "", /6 พ\.ย\. 2569/);
  assert.equal(formatBillingPeriodRange("invalid", endsAt, "en"), null);
  assert.equal(formatBillingPeriodRange(endsAt, startsAt, "en"), null);
});

test("a persisted RU market is immediately treated as saved", () => {
  assert.equal(billingMarketSelectionState({ persistedMarket: "RU", selectedMarket: "", saving: false, error: "" }), "saved");
  assert.equal(billingMarketSelectionState({ persistedMarket: "RU", selectedMarket: "RU", saving: false, error: "" }), "saved");
  assert.equal(billingMarketSelectionState({ persistedMarket: "RU", selectedMarket: "VN", saving: false, error: "" }), "unsaved");
  assert.equal(canPreviewBillingLines([{ marketCode: "RU" }]), true);
  assert.equal(canPreviewBillingLines([{ marketCode: "RU", selectedMarket: "VN" }]), false);
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

test("a new Location with an available product can be selected before saving its market", async () => {
  const source = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  assert.match(source, /availableProducts\.map\(\(product\) => \{/,
    "each purchasable Product has an independent selection control");
  assert.match(source, /toggleProduct\(location, product\.productId, event\.target\.checked\)/,
    "each Product can be toggled independently within a Location");
  assert.match(source, /\{hasSelection && <div className="customer-billing-wizard-line-controls"/,
    "market selection and save controls are available when any Product is selected");
  assert.match(source, /if \(!canPreviewBillingLines\([\s\S]*?billingWizardMarketsMustBeSaved/, "preview remains blocked until the market is saved and refreshed");
});

test("Product selection supports each Product alone, both at one Location, and independent durations", () => {
  const locations = [{ id: "loc-1", products: [
    { productId: "basic", purchaseEligible: true }, { productId: "divnitsa", purchaseEligible: true },
  ] }];
  let selection: Record<string, string[]> = {};
  selection = toggleBillingProductSelection(selection, "loc-1", "basic", true);
  assert.deepEqual(buildSelectedBillingLines(locations, selection, {}), [
    { locationId: "loc-1", productId: "basic", durationMonths: 1 },
  ]);
  selection = toggleBillingProductSelection({}, "loc-1", "divnitsa", true);
  assert.deepEqual(buildSelectedBillingLines(locations, selection, {}), [
    { locationId: "loc-1", productId: "divnitsa", durationMonths: 1 },
  ]);
  selection = toggleBillingProductSelection(selection, "loc-1", "basic", true);
  const durations = { [billingLineKey("loc-1", "basic")]: 1, [billingLineKey("loc-1", "divnitsa")]: 3 };
  assert.deepEqual(buildSelectedBillingLines(locations, selection, durations), [
    { locationId: "loc-1", productId: "basic", durationMonths: 1 },
    { locationId: "loc-1", productId: "divnitsa", durationMonths: 3 },
  ]);
  assert.deepEqual(billingOrderRequestPayload("org-1", buildSelectedBillingLines(locations, selection, durations)), {
    organizationId: "org-1",
    lines: [
      { locationId: "loc-1", productId: "basic", durationMonths: 1 },
      { locationId: "loc-1", productId: "divnitsa", durationMonths: 3 },
    ],
  });
  selection = toggleBillingProductSelection(selection, "loc-1", "basic", false);
  assert.deepEqual(buildSelectedBillingLines(locations, selection, durations), [
    { locationId: "loc-1", productId: "divnitsa", durationMonths: 3 },
  ]);
});

test("selected billing lines preserve multiple Locations and filter stale or inactive selections without duplicates", () => {
  const locations = [
    { id: "loc-1", products: [{ productId: "basic", purchaseEligible: true }, { productId: "hidden", purchaseEligible: false }] },
    { id: "loc-2", products: [{ productId: "basic", purchaseEligible: true }, { productId: "divnitsa", purchaseEligible: true }] },
  ];
  assert.deepEqual(buildSelectedBillingLines(locations, {
    "loc-1": ["basic", "hidden", "basic"], "loc-2": ["basic", "divnitsa"],
  }, { [billingLineKey("loc-2", "divnitsa")]: 2 }), [
    { locationId: "loc-1", productId: "basic", durationMonths: 1 },
    { locationId: "loc-2", productId: "basic", durationMonths: 1 },
    { locationId: "loc-2", productId: "divnitsa", durationMonths: 2 },
  ]);
});

test("pending-order recovery restores every Product/Location pair and its independent duration", () => {
  const restored = restoreBillingOrderSelection([
    { locationId: "loc-1", productId: "basic", durationMonths: 1 },
    { locationId: "loc-1", productId: "divnitsa", durationMonths: 3 },
    { locationId: "loc-2", productId: "basic", durationMonths: 6 },
  ]);
  assert.deepEqual(restored.selectedByLocation, { "loc-1": ["basic", "divnitsa"], "loc-2": ["basic"] });
  assert.deepEqual(restored.durations, {
    [billingLineKey("loc-1", "basic")]: 1,
    [billingLineKey("loc-1", "divnitsa")]: 3,
    [billingLineKey("loc-2", "basic")]: 6,
  });
  assert.equal(canResumeBillingOrder("pending"), true);
  assert.equal(canResumeBillingOrder("canceled"), false);
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

test("aggregate route, pricing, and provider incompatibilities receive specific messages", () => {
  assert.equal(billingOrderErrorKey("incompatible_routes", 2), "billingWizardIncompatibleRoutes");
  assert.equal(billingOrderErrorKey("unsupported_pricing", 2), "billingWizardMultiLocationPricingUnavailable");
  assert.equal(billingOrderErrorKey("route_unavailable", 2), "billingWizardMultiLocationRouteUnavailable");
  assert.equal(billingOrderErrorKey("provider_not_configured", 2), "billingProviderUnavailable");
});

test("aggregate Product/Location incompatibility messages remain localized", async () => {
  for (const language of ["en", "ru", "vi", "th"]) {
    const dictionary = await readFile(new URL(`../i18n/dictionaries/${language}.ts`, import.meta.url), "utf8");
    assert.match(dictionary, /billingWizardIncompatibleRoutes:/);
    assert.match(dictionary, /billingWizardMultiLocationRouteUnavailable:/);
    assert.match(dictionary, /billingWizardMultiLocationPricingUnavailable:/);
  }
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
  assert.match(source, /restoreBillingOrderSelection\(historyOrder\.lines\)/);
  assert.match(source, /billingLineKey\(line\.locationId, line\.productId\)/);
  assert.match(source, /billingPurchasedPeriod/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  const recoveryFlow = source.slice(source.indexOf("async function resumeOrder"), source.indexOf("async function copyLink"));
  assert.doesNotMatch(recoveryFlow, /fetch\("\/api\/v2\/customer\/billing\/orders"/,
    "resuming a pending checkout uses its original order instead of creating another");
  assert.match(source, /billingOrderRequestPayload\(organizationId, selectedLines\.map/,
    "quote and order creation serialize the same selected Location/Product line shape");
});

test("order review displays only server-calculated UTC period estimates with a settlement caveat", async () => {
  const source = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  const en = await readFile(new URL("../i18n/dictionaries/en.ts", import.meta.url), "utf8");
  const ru = await readFile(new URL("../i18n/dictionaries/ru.ts", import.meta.url), "utf8");
  const vi = await readFile(new URL("../i18n/dictionaries/vi.ts", import.meta.url), "utf8");
  const th = await readFile(new URL("../i18n/dictionaries/th.ts", import.meta.url), "utf8");
  assert.match(source, /line\.billingPeriodStartsAt && line\.billingPeriodEndsAt/);
  assert.match(source, /formatBillingPeriodRange\(line\.billingPeriodStartsAt, line\.billingPeriodEndsAt, locale\)/);
  assert.match(source, /billingWizardEstimatedDatesNote/);
  for (const dictionary of [en, ru, vi, th]) {
    assert.match(dictionary, /billingWizardExpectedPeriod:/);
    assert.match(dictionary, /billingWizardEstimatedDatesNote:/);
  }
});

test("the wizard renders its request error in only one place", async () => {
  const source = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/\{error\s*&&/g) ?? []).length, 1);
});
