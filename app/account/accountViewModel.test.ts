import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { accountPlanPresentation, shouldRefreshAccountOnReturn } from "./accountViewModel";

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

test("Account presents order periods as history and exposes Partner Benefits separately", async () => {
  const wizard = await readFile(new URL("./AccountBillingWizard.tsx", import.meta.url), "utf8");
  const account = await readFile(new URL("./AccountClient.tsx", import.meta.url), "utf8");
  assert.match(wizard, /<details className="customer-billing-orders">/);
  assert.match(wizard, /billingPurchasedPeriod/);
  assert.match(wizard, /canResumeBillingOrder\(item\.status\)/);
  assert.match(account, /billingLocation\.partnerBenefits\.map/);
  assert.match(account, /billingLocation\.products\.map/);
  assert.doesNotMatch(account, /billingMarketHelp/);
});
