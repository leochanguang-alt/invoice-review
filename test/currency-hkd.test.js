import assert from "node:assert/strict";
import test from "node:test";

import { computeAmountHkd, needsAmountHkd } from "../lib/currency-hkd.js";

test("needsAmountHkd is true for missing or zero values", () => {
    assert.equal(needsAmountHkd(null), true);
    assert.equal(needsAmountHkd(undefined), true);
    assert.equal(needsAmountHkd(0), true);
    assert.equal(needsAmountHkd(""), true);
    assert.equal(needsAmountHkd(12.5), false);
});

test("computeAmountHkd multiplies by the rate and rounds to 2 decimals", () => {
    assert.equal(computeAmountHkd(10, 7.8), 78);
    assert.equal(computeAmountHkd("12.25", 10.123), 124.01);
});

test("computeAmountHkd returns null for invalid amount or rate", () => {
    assert.equal(computeAmountHkd("abc", 7.8), null);
    assert.equal(computeAmountHkd(10, null), null);
    assert.equal(computeAmountHkd(10, Number.NaN), null);
});
