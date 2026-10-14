import assert from "node:assert/strict";
import test from "node:test";
import { productPriceInputFromMinor, productPriceMinorFromInput } from "./productPriceInput";

test("converts RUB amounts to minor units without float rounding", () => {
  assert.equal(productPriceMinorFromInput("1080"), 108_000);
  assert.equal(productPriceMinorFromInput("1500.05"), 150_005);
  assert.equal(productPriceMinorFromInput("0.01"), 1);
  assert.equal(productPriceInputFromMinor(150_005), "1500.05");
  assert.equal(productPriceInputFromMinor(2_147_483_647), "21474836.47");
  assert.equal(productPriceMinorFromInput("  "), null);
});

test("rejects malformed, zero, negative, excessive precision and overflow amounts", () => {
  for (const amount of ["-1", "1.001", "1,50", "0", "21474836.48", "1e3"]) {
    assert.throws(() => productPriceMinorFromInput(amount));
  }
});
