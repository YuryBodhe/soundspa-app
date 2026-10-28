import assert from "node:assert/strict";
import test from "node:test";
import { currencyMinorDigits, formatMinorAmount, parseMajorAmount } from "./paymentAmount";

test("manual payment amounts parse exactly in each currency's minor unit", () => {
  assert.equal(parseMajorAmount("100.01", "RUB"), "10001");
  assert.equal(parseMajorAmount("10001", "JPY"), "10001");
  assert.equal(currencyMinorDigits("KWD"), 3);
  assert.equal(parseMajorAmount("1.234", "KWD"), "1234");
  assert.equal(parseMajorAmount("1.2345", "KWD"), null);
  assert.equal(parseMajorAmount("1,000.00", "RUB"), null);
  assert.equal(formatMinorAmount("10001", "RUB"), "100.01");
});
