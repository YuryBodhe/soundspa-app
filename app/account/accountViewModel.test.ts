import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { accountLocationPresentation, accountPlanPresentation, accountScheduledPaidPeriodRanges, shouldRefreshAccountOnReturn } from "./accountViewModel";

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
  assert.equal(view.summaryProducts.length, 1, "a trial-only Location remains visible without a scheduled-period label");
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

test("collapsed summaries can show scheduled paid coverage beside an active trial without changing current status", () => {
  const view = accountLocationPresentation([{
    productId: "basic", productName: "SoundSpa Basic", status: "trial",
    trialEndsAt: "2026-11-06T15:16:28.704Z", paidThrough: null, trialActive: true,
    scheduledPaidPeriods: [{ startsAt: "2026-11-06T15:16:28.704Z", endsAt: "2026-12-06T15:16:28.704Z" }],
  }, {
    productId: "spa", productName: "Spaquatoria", status: "partner",
    trialEndsAt: null, paidThrough: null, trialActive: false, scheduledPaidPeriods: [],
  }], [{ productId: "spa", startsAt: "2026-10-07T07:05:10.899Z", endsAt: null }], now);
  assert.equal(view.activeProductCount, 2);
  assert.deepEqual(view.summaryProducts.map((plan) => plan.productName), ["SoundSpa Basic", "Spaquatoria"]);
  assert.equal(view.products[0].status, "trial");
  assert.equal(view.products[0].trialRemainingDays, 28);
  assert.equal(view.products[1].status, "partner");
  assert.equal(view.products[1].accessExpiresAt, null);
  assert.equal(view.accessExpiresAt, null, "the Location summary must not merge the trial and indefinite Partner Benefit windows");
});

test("a future-only paid Product remains in the collapsed summary without claiming current access", () => {
  const view = accountLocationPresentation([{
    productId: "basic", productName: "SoundSpa Basic", status: "expired",
    trialEndsAt: null, paidThrough: null, trialActive: false,
    scheduledPaidPeriods: [{ startsAt: "2026-11-06T00:00:00.000Z", endsAt: "2026-12-06T00:00:00.000Z" }],
  }], [], now);
  assert.equal(view.activeProductCount, 0);
  assert.deepEqual(view.summaryProducts.map((plan) => plan.productId), ["basic"]);
  assert.equal(view.accessExpiresAt, null);
});

test("scheduled paid periods format individually and omit malformed or absent periods", () => {
  const formatter = (value: string) => value.slice(0, 10);
  assert.deepEqual(accountScheduledPaidPeriodRanges(undefined, formatter), []);
  assert.deepEqual(accountScheduledPaidPeriodRanges([
    { startsAt: "2026-11-06T15:16:28.704Z", endsAt: "2026-12-06T15:16:28.704Z" },
    { startsAt: "2026-12-06T15:16:28.704Z", endsAt: "2027-01-06T15:16:28.704Z" },
    { startsAt: "bad-date", endsAt: "2027-02-01T00:00:00.000Z" },
    { startsAt: "2027-02-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z" },
  ], formatter), ["2026-11-06 – 2026-12-06", "2026-12-06 – 2027-01-06"]);
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

test("Account keeps billing actions and histories while collapsed salon rows stay compact", async () => {
  const wizard = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  const account = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../globals.css", import.meta.url), "utf8");
  assert.match(wizard, /<details className="customer-billing-orders customer-account-bottom-disclosure">/);
  assert.match(wizard, /billingPurchasedPeriod/);
  assert.match(wizard, /canResumeBillingOrder\(item\.status\)/);
  assert.match(wizard, /className="customer-auth-submit customer-billing-wizard-open"/);
  assert.match(wizard, /selectedLines\.map/);
  assert.match(wizard, /createOrderAndCheckout/);
  assert.match(account, /className="customer-account-locations"/);
  assert.match(account, /group\.locations\.map/);
  assert.match(account, /accountLocationPresentation\(billingLocation\.products, billingLocation\.partnerBenefits\)/);
  assert.match(account, /<details className="customer-account-location-details">/);
  assert.match(account, /customer-account-device-disclosure/);
  assert.match(account, /group\.locations\.map\(renderDevicesForLocation\)/);
  const summaries = [...account.matchAll(/<summary className="customer-account-location-summary">([\s\S]*?)<\/summary>/g)].map((match) => match[1]);
  assert.ok(summaries.length > 0);
  for (const summary of summaries) {
    assert.match(summary, /customer-account-location-name/);
    assert.match(summary, /customer-account-chevron/);
    assert.doesNotMatch(summary, /customer-account-access-pill|customer-account-location-meta|billingAccessExpires|partnerName/);
  }
  assert.match(account, /plan\.scheduledPaidPeriods\.map/);
  assert.match(account, /plan\.status === "trial" && plan\.trialEndsAt \? trialSummaryText\(plan\)/);
  assert.match(account, /plan\.status !== "partner" && billingLocation\.partnerBenefits/);
  assert.match(account, /plan\.accessExpiresAt && !\(plan\.status === "trial" && plan\.trialEndsAt\)/);
  assert.doesNotMatch(account, /customer-account-location-details" open/);
  assert.doesNotMatch(account, /customer-account-device-disclosure" open/);
  assert.doesNotMatch(account, /accountMultipleAccessStates/);
  assert.doesNotMatch(account, /customer-account-devices-details/);
  assert.match(account, /customer-account-cancel-renewal/);
  assert.doesNotMatch(account, /customer-billing-action/);
  assert.doesNotMatch(account, /billingMarketHelp/);
  assert.match(css, /customer-account-shell \{ width: min\(100%, 920px\)/);
  assert.match(css, /customer-account-locations \{ display: grid/);
  assert.match(css, /customer-account-location-summary:focus-visible/);
  assert.match(css, /customer-account-product-row/);
  assert.match(css, /customer-billing-wizard-link-actions > a\.customer-auth-submit \{ color: #08070a; background: var\(--accent\);/);
  assert.match(css, /customer-billing-wizard-link-actions > a\.customer-auth-submit:hover/);
  assert.match(css, /customer-billing-wizard-link-actions > a\.customer-auth-submit:focus-visible/);
  assert.match(css, /\.customer-auth-submit:disabled \{ opacity: \.6; cursor: wait; \}/);
  assert.match(css, /background: var\(--accent\)/);
  assert.match(css, /customer-billing-wizard-check \{\s*display: grid;\s*grid-template-columns: 21px/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.doesNotMatch(account, /billingLocation\.partnerBenefits\.map/);
});

test("compact Account labels and organization billing action are localized in every supported language", async () => {
  const dictionaries = await Promise.all(["en", "ru", "vi", "th"].map((locale) => readFile(new URL(`../i18n/dictionaries/${locale}.ts`, import.meta.url), "utf8")));
  for (const dictionary of dictionaries) {
    assert.match(dictionary, /billingWizardOpen:/);
    assert.match(dictionary, /accountAccessActive:/);
    assert.match(dictionary, /accountNoActiveAccess:/);
    assert.match(dictionary, /accountTrialUntil:/);
    assert.match(dictionary, /accountNextPaidPeriod:/);
    assert.match(dictionary, /accountNextPaidPeriods:/);
    assert.match(dictionary, /billingOrdersTitle: 'Order history'|billingOrdersTitle: 'История заказов'|billingOrdersTitle: 'Lịch sử đơn hàng'|billingOrdersTitle: 'ประวัติคำสั่งซื้อ'/);
  for (const key of ["accountDashboardSubtitle:", "accountOpenPlayer:", "accountSalonCount:"]) {
      assert.ok(dictionary.includes(key), `missing ${key}`);
    }
    for (const removedKey of ["accountPlayerTitle:", "accountPlayerHelp:", "accountLocationsTitle:", "accountLocationCount:", "accountLocationCountOne:", "accountSubscriptionsPayments:"]) {
      assert.ok(!dictionary.includes(removedKey), `unexpected obsolete label ${removedKey}`);
    }
  }
  const ru = await readFile(new URL("../i18n/dictionaries/ru.ts", import.meta.url), "utf8");
  assert.match(ru, /accountNextPaidPeriod: 'Следующий оплаченный период: \{\{period\}\}'/);
});

test("mobile Billing Wizard step labels use readable type and can wrap within narrow columns", async () => {
  const css = await readFile(new URL("../globals.css", import.meta.url), "utf8");
  assert.match(css, /\.customer-account-shell \.customer-billing-wizard-steps li \{ font-size: 15px; \}/);
  assert.match(css, /\.customer-billing-wizard-steps \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.customer-billing-wizard-steps li > span:last-child \{ min-width: 0; overflow-wrap: anywhere; \}/);
});

test("Account dashboard uses a single player action and keeps salon actions inside expanded details", async () => {
  const account = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  const wizard = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../globals.css", import.meta.url), "utf8");
  const locationDetailsStart = account.lastIndexOf('<details className="customer-account-location-details">');
  const locationDetailsEnd = account.indexOf("</details>", locationDetailsStart);
  const locationDetails = account.slice(locationDetailsStart, locationDetailsEnd);
  assert.match(account, /<a href="\/player" target="_blank" rel="noopener noreferrer">\{t\("accountOpenPlayer"\)\}/);
  assert.doesNotMatch(account, /accountPlayerTitle|accountPlayerHelp/);
  assert.match(account, /accountSalonCount/);
  assert.match(account, /t\("addLocation"\)/);
  assert.match(account, /customer-account-add-location-form/);
  assert.match(account, /customer-account-device-disclosure/);
  assert.match(wizard, /billingOrdersTitle/);
  assert.doesNotMatch(wizard, /accountSubscriptionsPayments/);
  assert.match(wizard, /billingWizardOpen/);
  assert.match(locationDetails, /<SpaquatoriaPromoRedeemer locationId=\{location\.id\}/);
  assert.match(css, /customer-account-player-entry a \{ width: min\(100%, 400px\);/);
  assert.match(css, /grid-template-areas: "name chevron"/);
  assert.match(css, /customer-account-locations \{ gap: 9px;/);
});

test("the billing API exposes only future, non-invalidated paid periods to Account", async () => {
  const source = await readFile(new URL("../../db/v2/services/customerBilling.ts", import.meta.url), "utf8");
  assert.match(source, /isNull\(locationSubscriptions\.invalidatedByResetId\)/);
  assert.match(source, /candidate\.startsAt > now/);
  assert.match(source, /candidate\.currentPeriodEndsAt !== null && candidate\.currentPeriodEndsAt > candidate\.startsAt/);
  assert.match(source, /scheduledPaidPeriods: subscriptions\.filter/);
});

test("only Organizations advertised as Owner-capable render Add Location, and success refreshes Account", async () => {
  const account = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  const locations = await readFile(new URL("../../db/v2/services/customerDevices.ts", import.meta.url), "utf8");
  assert.match(locations, /canCreateLocations: location\.membershipRole === "owner"/);
  assert.match(account, /group\.canCreateLocations &&/);
  assert.match(account, /fetch\("\/api\/v2\/customer\/locations"/);
  assert.match(account, /setNewLocationTimezone\(group\.locations\[0\]\?\.timezone \?\? ""\)/);
  assert.match(account, /await load\(true\)/);
  assert.match(account, /locations=\{billing\.locations\.filter\(\(location\) => location\.organizationId === organizationId\)\}/);
  assert.match(account, /group\.locations\.map\(renderDevicesForLocation\)/);
});

test("Add Location labels and customer-facing errors are localized in RU, EN, VI, and TH", async () => {
  const dictionaries = await Promise.all(["en", "ru", "vi", "th"].map((locale) => readFile(new URL(`../i18n/dictionaries/${locale}.ts`, import.meta.url), "utf8")));
  for (const dictionary of dictionaries) {
    for (const key of ["addLocation:", "addLocationName:", "addLocationTimezone:", "addLocationSave:", "addLocationSaving:", "addLocationCancel:", "addLocationInvalid:", "addLocationDuplicate:", "addLocationLimit:", "addLocationUnauthorized:", "addLocationUnavailable:"]) {
      assert.ok(dictionary.includes(key), `missing ${key}`);
    }
  }
});
