import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { accountLocationPresentation, accountPlanPresentation, shouldRefreshAccountOnReturn } from "./accountViewModel";

const now = Date.parse("2026-10-09T15:16:28.704Z");

test("post-reset trial presentation does not use the preserved historical paid period", () => {
  const view = accountPlanPresentation({
    productId: "soundspa-basic",
    status: "trial",
    trialEndsAt: "2026-11-06T15:16:28.704Z",
    paidThrough: "2026-11-09T10:24:00.385Z",
    trialActive: true,
  }, [], now);
  assert.equal(view.trialRemainingDays, 28);
  assert.equal(view.accessExpiresAt, "2026-11-06T15:16:28.704Z");
});

test("subscription and Partner Benefit expiry remain separate access sources", () => {
  const benefit = { productId: "partner-product", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z" };
  assert.deepEqual(accountPlanPresentation({ productId: "soundspa-basic", status: "subscription", trialEndsAt: null, paidThrough: "2026-11-09T10:24:00.385Z", trialActive: false }, [benefit], now), {
    trialRemainingDays: null,
    accessExpiresAt: "2026-11-09T10:24:00.385Z",
  });
  assert.deepEqual(accountPlanPresentation({ productId: "partner-product", status: "partner", trialEndsAt: null, paidThrough: null, trialActive: false }, [benefit], now), {
    trialRemainingDays: null,
    accessExpiresAt: "2026-10-31T00:00:00.000Z",
  });
});

test("a single Location summary shows its single trial Product and remaining days", () => {
  const view = accountLocationPresentation([{
    productId: "basic", productName: "SoundSpa Basic", status: "trial",
    trialEndsAt: "2026-11-06T15:16:28.704Z", paidThrough: null, trialActive: true,
  }], [], now);
  assert.equal(view.summaryKind, "single");
  assert.equal(view.activeProductCount, 1);
  assert.equal(view.activeProducts[0].productName, "SoundSpa Basic");
  assert.equal(view.accessExpiresAt, "2026-11-06T15:16:28.704Z");
  assert.equal(view.trialRemainingDays, 28);
});

test("a current paid Product still surfaces its independent active trial window", () => {
  const view = accountLocationPresentation([{
    productId: "basic", productName: "SoundSpa Basic", status: "subscription",
    trialEndsAt: "2026-11-06T15:16:28.704Z", paidThrough: "2026-11-09T10:24:00.385Z", trialActive: true,
  }], [], now);
  assert.equal(view.trialRemainingDays, 28);
  assert.equal(view.accessExpiresAt, "2026-11-09T10:24:00.385Z");
});

test("multiple Product entitlements keep distinct expiry dates in details, not a combined date", () => {
  const view = accountLocationPresentation([
    { productId: "basic", productName: "SoundSpa Basic", status: "subscription", trialEndsAt: null, paidThrough: "2026-11-09T10:24:00.385Z", trialActive: false },
    { productId: "spa", productName: "Spaquatoria", status: "partner", trialEndsAt: null, paidThrough: null, trialActive: false },
  ], [{ productId: "spa", startsAt: "2026-10-07T07:05:10.899Z", endsAt: null }], now);
  assert.equal(view.summaryKind, "multiple");
  assert.equal(view.activeProductCount, 2);
  assert.equal(view.hasDifferentAccessStates, true);
  assert.equal(view.hasDifferentAccessExpirations, true);
  assert.equal(view.accessExpiresAt, null);
  assert.equal(view.products[0].accessExpiresAt, "2026-11-09T10:24:00.385Z");
  assert.equal(view.products[1].accessExpiresAt, null);
});

test("Account return refreshes only for a visible page and is throttled", () => {
  assert.equal(shouldRefreshAccountOnReturn(5000, 3000, true), true);
  assert.equal(shouldRefreshAccountOnReturn(3500, 3000, true), false);
  assert.equal(shouldRefreshAccountOnReturn(5000, 3000, false), false);
});

test("Account reloads cancel older responses and listens for tab and page restoration", async () => {
  const source = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  assert.match(source, /loadController\.current\?\.abort\(\)/);
  assert.match(source, /version !== loadVersion\.current/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /window\.addEventListener\("pageshow"/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
});

test("Account presents one organization-level billing action and compact Location summaries", async () => {
  const wizard = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  const account = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../globals.css", import.meta.url), "utf8");
  assert.match(wizard, /<details className="customer-billing-orders">/);
  assert.match(wizard, /billingPurchasedPeriod/);
  assert.match(wizard, /canResumeBillingOrder\(item\.status\)/);
  assert.match(wizard, /className="customer-auth-submit customer-billing-wizard-open"/);
  assert.match(wizard, /selectedLines\.map/);
  assert.match(wizard, /createOrderAndCheckout/);
  assert.match(account, /className="customer-account-locations"/);
  assert.match(account, /group\.locations\.map/);
  assert.match(account, /accountLocationPresentation\(billingLocation\.products, billingLocation\.partnerBenefits\)/);
  assert.match(account, /accountMultipleAccessStates/);
  assert.match(account, /customer-account-cancel-renewal/);
  assert.doesNotMatch(account, /customer-billing-action/);
  assert.doesNotMatch(account, /billingMarketHelp/);
  assert.match(css, /customer-account-shell \{ width: min\(100%, 920px\)/);
  assert.match(css, /customer-account-locations \{ display: grid/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(account, /billingLocation\.partnerBenefits\.map/);
});

test("the organization billing action and summary messages are localized in English and Russian", async () => {
  const en = await readFile(new URL("../i18n/dictionaries/en.ts", import.meta.url), "utf8");
  const ru = await readFile(new URL("../i18n/dictionaries/ru.ts", import.meta.url), "utf8");
  for (const dictionary of [en, ru]) {
    assert.match(dictionary, /billingWizardOpen:/);
    assert.match(dictionary, /accountMultipleProductAccess:/);
    assert.match(dictionary, /accountMultipleAccessStates:/);
    assert.match(dictionary, /accountProductPeriodsDiffer:/);
    assert.match(dictionary, /accountProductDetails:/);
  }
});
