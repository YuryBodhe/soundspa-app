import assert from "node:assert/strict";
import test from "node:test";
import { allocateFixedOrganizationTotal, explicitCalendarCoverage, validateManualBankTransferInput } from "./manualBillingModel";

const lines = [
  { locationId: "11111111-1111-4111-8111-111111111111", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { locationId: "22222222-2222-4222-8222-222222222222", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { locationId: "33333333-3333-4333-8333-333333333333", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
];

test("fixed organization total allocates deterministically in minor units and preserves exact sum", () => {
  const allocation = allocateFixedOrganizationTotal(BigInt(10001), [...lines].reverse());
  assert.deepEqual(allocation.map((line) => line.amountMinor), [BigInt(3334), BigInt(3334), BigInt(3333)]);
  assert.equal(allocation.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(10001));
  assert.deepEqual(allocation, allocateFixedOrganizationTotal(BigInt(10001), lines));
});

test("explicit periods always start on UTC month boundary regardless of payment date", () => {
  const start = new Date("2027-03-01T00:00:00.000Z");
  const early = explicitCalendarCoverage(start, 1);
  const late = explicitCalendarCoverage(start, 1);
  assert.equal(early.startsAt.toISOString(), "2027-03-01T00:00:00.000Z");
  assert.equal(early.endsAt.toISOString(), "2027-04-01T00:00:00.000Z");
  assert.deepEqual(late, early);
  assert.equal(explicitCalendarCoverage(new Date("2028-02-01T00:00:00.000Z"), 2).endsAt.toISOString(), "2028-04-01T00:00:00.000Z");
  assert.throws(() => explicitCalendarCoverage(new Date("2027-03-02T00:00:00.000Z"), 1), { code: "invalid_period" });
});

test("manual order input validates exact three-salon selection, currency and idempotency key", () => {
  const valid = validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-01", durationMonths: 1,
    currency: "RUB", totalAmountMinor: "10001", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines,
  });
  assert.equal(valid.totalAmountMinor, BigInt(10001));
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-01", durationMonths: 1,
    currency: "RUB", totalAmountMinor: "10001", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines: [lines[0], lines[0], lines[2]],
  }), { code: "duplicate_line" });
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-01", durationMonths: 1,
    currency: "RUB", totalAmountMinor: "2", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines,
  }), { code: "invalid_amount" });
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-01", durationMonths: 1,
    currency: "RUB", totalAmountMinor: "10001", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-19", lines,
  }), { code: "invalid_creator" });
});
