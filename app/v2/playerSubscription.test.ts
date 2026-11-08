import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { playerSubscriptionLines } from "./playerSubscription";

const currentLocation = "location-01";

test("player uses server-provided active trial end and paid subscription dates for the device Location", () => {
  const lines = playerSubscriptionLines({ locations: [
    { id: "another-location", products: [{ productId: "other", productName: "Other", status: "trial", trialActive: true, trialEndsAt: "2026-12-01T00:00:00.000Z" }] },
    { id: currentLocation, products: [
      { productId: "basic", productName: "Basic", status: "trial", trialActive: true, trialEndsAt: "2026-12-02T00:00:00.000Z" },
      { productId: "plus", productName: "Plus", status: "subscription", subscriptionCanceled: false, paidThrough: "2027-01-02T00:00:00.000Z" },
      { productId: "canceling", productName: "Canceling", status: "subscription", subscriptionCanceled: true, paidThrough: "2026-12-20T00:00:00.000Z" },
      { productId: "future", productName: "Future", status: "upcoming", paidStartsAt: "2027-01-02T00:00:00.000Z", paidThrough: "2027-02-02T00:00:00.000Z" },
      { productId: "old", productName: "Old", status: "expired", paidThrough: "2026-10-02T00:00:00.000Z" },
    ] },
  ] }, currentLocation);

  assert.deepEqual(lines.map(({ productId, kind, date, startsAt }) => ({ productId, kind, date, startsAt })), [
    { productId: "basic", kind: "trial", date: "2026-12-02T00:00:00.000Z", startsAt: null },
    { productId: "plus", kind: "active", date: "2027-01-02T00:00:00.000Z", startsAt: null },
    { productId: "canceling", kind: "canceled", date: "2026-12-20T00:00:00.000Z", startsAt: null },
    { productId: "future", kind: "upcoming", date: "2027-02-02T00:00:00.000Z", startsAt: "2027-01-02T00:00:00.000Z" },
    { productId: "old", kind: "expired", date: "2026-10-02T00:00:00.000Z", startsAt: null },
  ]);
});

test("player ignores missing, invalid, unauthorized-location, and non-entitlement billing data", () => {
  assert.deepEqual(playerSubscriptionLines({}, currentLocation), []);
  assert.deepEqual(playerSubscriptionLines({ locations: [{ id: "other", products: [{ productId: "p", productName: "P", status: "subscription", paidThrough: "2027-01-01" }] }] }, currentLocation), []);
  assert.deepEqual(playerSubscriptionLines({ locations: [{ id: currentLocation, products: [
    { productId: "bad-date", productName: "Bad", status: "trial", trialActive: true, trialEndsAt: "not-a-date" },
    { productId: "partner", productName: "Partner", status: "partner", paidThrough: null },
  ] }] }, currentLocation), []);
});

test("only device-authenticated player pages request the existing customer billing API; local preview remains distinct", async () => {
  const source = await readFile(new URL("./V2Player.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!deviceId \|\| !locationId\) \{/);
  assert.match(source, /fetch\("\/api\/v2\/customer\/billing", \{ credentials: "same-origin", cache: "no-store" \}\)/);
  assert.match(source, /!deviceId &&/);
  assert.match(source, /t\("noAccount"\)/);
});

test("customer billing endpoint remains verified-session protected and the device catalog contains no billing fields", async () => {
  const route = await readFile(new URL("../api/v2/customer/billing/route.ts", import.meta.url), "utf8");
  const catalog = await readFile(new URL("./customerCatalog.tsx", import.meta.url), "utf8");
  assert.match(route, /getVerifiedCustomerPaymentSession\(request\)/);
  assert.match(route, /status: 401/);
  assert.match(catalog, /\/api\/v2\/catalog/);
  assert.doesNotMatch(catalog, /\/api\/v2\/customer\/billing/);
});

test("player subscription status copy is localized across all supported languages", async () => {
  const dictionaries = await Promise.all(["en", "ru", "vi", "th"].map((locale) =>
    readFile(new URL(`../i18n/dictionaries/${locale}.ts`, import.meta.url), "utf8")));
  for (const dictionary of dictionaries) {
    for (const key of ["playerTrialUntil:", "playerSubscriptionActive:", "playerSubscriptionCanceled:", "playerSubscriptionUpcoming:", "playerSubscriptionExpired:", "billingPaidThrough:"]) {
      assert.ok(dictionary.includes(key), `missing localized ${key}`);
    }
  }
  assert.match(dictionaries[1], /playerTrialUntil: "Пробный период — до \{\{date\}\}"/);
});
