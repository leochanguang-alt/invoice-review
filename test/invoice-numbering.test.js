import assert from "node:assert/strict";
import test from "node:test";
import {
    buildRenumberManifest,
    formatInvoiceId,
    parseProjectSequence,
} from "../lib/invoice-numbering.js";

test("formats positive and negative invoice IDs", () => {
    assert.equal(formatInvoiceId({
        projectCode: "Neoss-MoEx-2608",
        sequence: 9,
        amount: "780.4",
        currency: "sek",
    }), "Neoss-MoEx-2608-0009-780SEK");
    assert.equal(formatInvoiceId({
        projectCode: "P",
        sequence: 2,
        amount: "-12.6",
        currency: "gbp",
    }), "P-0002-m13GBP");
});

test("parses sequence after a project code containing hyphens", () => {
    assert.equal(
        parseProjectSequence("Neoss-MoEx-2608-0018-31EUR", "Neoss-MoEx-2608"),
        18,
    );
});

test("builds a date then id ordered contiguous manifest", () => {
    const manifest = buildRenumberManifest([
        { id: 3, invoice_date: "2026-08-02", amount: 20, currency: "GBP", achieved_file_id: "old/c.pdf" },
        { id: 2, invoice_date: "2026-08-01", amount: 10, currency: "EUR", achieved_file_id: "old/b.pdf" },
        { id: 1, invoice_date: "2026-08-01", amount: 5, currency: "SEK", achieved_file_id: "old/a.pdf" },
    ], "Neoss-MoEx-2608");
    assert.deepEqual(manifest.map(item => [item.invoiceId, item.sequence]), [
        [1, 1],
        [2, 2],
        [3, 3],
    ]);
});
