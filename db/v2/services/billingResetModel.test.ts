import assert from "node:assert/strict";
import test from "node:test";
import {
  billingResetEnvironmentAllowed,
  billingResetPlanHash,
  billingResetSafetyIssue,
  validateBillingResetInput,
  type BillingResetPlan,
} from "./billingResetModel";

const org = "11111111-1111-4111-8111-111111111111";
const location = "22222222-2222-4222-8222-222222222222";
const product = "33333333-3333-4333-8333-333333333333";
const subscription = "44444444-4444-4444-8444-444444444444";
const trial = "55555555-5555-4555-8555-555555555555";
const order = "66666666-6666-4666-8666-666666666666";
const payment = "77777777-7777-4777-8777-777777777777";
const input = { organizationId: org, locationId: location, productIds: [product], trialProductId: product, trialDurationDays: 30, reason: "Repeat local staging test" };
const plan: BillingResetPlan = {
  organizationId: org, organizationName: "Bodhe Spa", locationId: location, locationName: "Hamam",
  products: [{ id: product, code: "soundspa", name: "SoundSpa Basic" }],
  subscriptions: [{ id: subscription, productId: product, status: "active", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z", invalidatedByResetId: null }],
  trials: [{ id: trial, productId: product, status: "expired", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z", invalidatedByResetId: null }],
  orders: [{ id: order, status: "pending", paymentId: payment, paymentStatus: "pending", providerCode: "fake-staging", lineIds: ["88888888-8888-4888-8888-888888888888"], allLinesInScope: true }],
  standalonePayments: [],
  legacyLocationAccess: null,
};

test("billing reset request requires explicit scoped identities, trial duration, and reason", () => {
  assert.deepEqual(validateBillingResetInput(input).productIds, [product]);
  assert.throws(() => validateBillingResetInput({ ...input, productIds: [] }), /invalid_billing_reset_request/);
  assert.throws(() => validateBillingResetInput({ ...input, trialDurationDays: 366 }), /invalid_billing_reset_request/);
  assert.throws(() => validateBillingResetInput({ ...input, reason: "test" }), /invalid_billing_reset_request/);
});

test("billing reset preview hash is deterministic and changes with billing state", () => {
  assert.equal(billingResetPlanHash(input, plan), billingResetPlanHash(input, { ...plan, orders: [...plan.orders].reverse() }));
  assert.notEqual(billingResetPlanHash(input, plan), billingResetPlanHash(input, { ...plan, trials: [] }));
});

test("reset permits Fake pending checkout and preserves paid history", () => {
  assert.equal(billingResetSafetyIssue(plan, [product]), null);
  const paid = { ...plan, orders: [{ ...plan.orders[0], status: "paid", paymentStatus: "succeeded" }] };
  assert.equal(billingResetSafetyIssue(paid, [product]), null);
});

test("reset rejects non-Fake pending payments and aggregate orders outside scope", () => {
  assert.equal(billingResetSafetyIssue({ ...plan, orders: [{ ...plan.orders[0], providerCode: "prodamus" }] }, [product]), "non_fake_pending_payment");
  assert.equal(billingResetSafetyIssue({ ...plan, orders: [{ ...plan.orders[0], allLinesInScope: false }] }, [product]), "aggregate_order_out_of_scope");
  assert.equal(billingResetSafetyIssue({ ...plan, orders: [{ ...plan.orders[0], paymentStatus: "unknown" }] }, [product]), "unknown_payment_state");
  assert.equal(billingResetSafetyIssue({ ...plan, orders: [{ ...plan.orders[0], status: "paid", paymentStatus: "pending" }] }, [product]), "order_payment_state_conflict");
});

test("Location-wide legacy commercial access requires explicitly including all Products", () => {
  const legacyPlan = { ...plan, legacyLocationAccess: { trialEndsAt: null, paidThrough: "2026-12-01T00:00:00.000Z", activeAtPreview: true } };
  assert.equal(billingResetSafetyIssue(legacyPlan, [product]), "legacy_location_access_out_of_scope");
  assert.equal(billingResetSafetyIssue(legacyPlan, [product], { includeAllProducts: true }), null);
});

test("staging guard rejects production, wrong origin, wrong database, and allows only exact disposable test identity", () => {
  const base = { V2_DEPLOYMENT_ENV: "staging", V2_PUBLIC_ORIGIN: "https://test.soundspa.bodhemusic.com", V2_DATABASE_URL: "postgresql://soundspa_v2:secret@v2-postgres:5432/soundspa_v2" };
  assert.equal(billingResetEnvironmentAllowed(base), true);
  assert.equal(billingResetEnvironmentAllowed({ ...base, V2_DEPLOYMENT_ENV: "production" }), false);
  assert.equal(billingResetEnvironmentAllowed({ ...base, V2_PUBLIC_ORIGIN: "https://soundspa.bodhemusic.com" }), false);
  assert.equal(billingResetEnvironmentAllowed({ ...base, V2_DATABASE_URL: "postgresql://user:secret@db:5432/soundspa_v2" }), false);
  assert.equal(billingResetEnvironmentAllowed({ ...base, V2_BILLING_RESET_TEST_ALLOW_DATABASE: "1", V2_DATABASE_URL: "postgresql://soundspa_v2_test:secret@127.0.0.1:5432/soundspa_v2" }), true);
  assert.equal(billingResetEnvironmentAllowed({ ...base, V2_BILLING_RESET_TEST_ALLOW_DATABASE: "1", V2_DEPLOYMENT_ENV: "production", V2_DATABASE_URL: "postgresql://soundspa_v2_test:secret@127.0.0.1:5432/soundspa_v2" }), false);
});
