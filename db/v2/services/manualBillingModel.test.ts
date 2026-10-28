import assert from "node:assert/strict";
import test from "node:test";
import { allocateFixedOrganizationTotal, explicitCalendarCoverage, explicitDateCoverage, validateManualBankTransferInput } from "./manualBillingModel";

const lines = [
  { locationId: "11111111-1111-4111-8111-111111111111", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { locationId: "22222222-2222-4222-8222-222222222222", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { locationId: "33333333-3333-4333-8333-333333333333", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
];

test("fixed organization totals allocate deterministically for any positive salon count", () => {
  const allocation = allocateFixedOrganizationTotal(BigInt(10001), [...lines].reverse());
  assert.deepEqual(allocation.map((line) => line.amountMinor), [BigInt(3334), BigInt(3334), BigInt(3333)]);
  assert.equal(allocation.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(10001));
  assert.deepEqual(allocation, allocateFixedOrganizationTotal(BigInt(10001), lines));
  for (const selected of [lines.slice(0, 1), lines.slice(0, 2), [...lines, { locationId: "44444444-4444-4444-8444-444444444444", productId: lines[0].productId }]]) {
    const allocated = allocateFixedOrganizationTotal(BigInt(1), selected);
    assert.equal(allocated.reduce((sum, line) => sum + line.amountMinor, BigInt(0)), BigInt(1));
    assert.equal(allocated.length, selected.length);
  }
});

test("manual coverage is an exact UTC half-open interval with a non-calendar end", () => {
  const period = explicitDateCoverage("2027-03-15", "2027-04-10");
  assert.equal(period.startsAt.toISOString(), "2027-03-15T00:00:00.000Z");
  assert.equal(period.endsAt.toISOString(), "2027-04-10T00:00:00.000Z");
  assert.throws(() => explicitDateCoverage("2027-03-15", "2027-03-15"), { code: "invalid_period" });
  assert.throws(() => explicitDateCoverage("2027-02-30", "2027-03-15"), { code: "invalid_period" });
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

test("manual order input accepts one or more salons and validates currency, dates and idempotency", () => {
  const valid = validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-15", periodEnd: "2027-04-10",
    currency: "RUB", totalAmountMinor: "1", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines: [lines[0]],
  });
  assert.equal(valid.totalAmountMinor, BigInt(1));
  assert.equal(valid.lines.length, 1);
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-15", periodEnd: "2027-04-10",
    currency: "RUB", totalAmountMinor: "10001", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines: [lines[0], lines[0]],
  }), { code: "duplicate_line" });
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-15", periodEnd: "2027-04-10",
    currency: "USD", totalAmountMinor: "2", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines: [lines[0]],
  }), { code: "invalid_request" });
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-15", periodEnd: "2027-04-10",
    currency: "RUB", totalAmountMinor: "0", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-24", lines: [lines[0]],
  }), { code: "invalid_amount" });
  assert.throws(() => validateManualBankTransferInput({
    organizationId: "99999999-9999-4999-8999-999999999999", operator: "operator", reason: "Approved March invoice",
    idempotencyKey: "invoice-2027-03-samui", periodStart: "2027-03-15", periodEnd: "2027-04-10",
    currency: "RUB", totalAmountMinor: "10001", invoiceNumber: "SAM-2027-03", invoiceIssuedAt: "2027-02-20", paymentDueAt: "2027-02-19", lines: [lines[0]],
  }), { code: "invalid_creator" });
});
