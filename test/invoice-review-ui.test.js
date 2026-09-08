import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadInvoiceReview() {
    const source = await readFile(
        new URL("../public/invoice-review.js", import.meta.url),
        "utf8",
    );
    const context = {};
    vm.runInNewContext(source, context);
    return context;
}

test("isReviewableStatus keeps waiting and confirmed invoices", async () => {
    const { isReviewableStatus } = await loadInvoiceReview();
    assert.equal(isReviewableStatus("Waiting for Confirm"), true);
    assert.equal(isReviewableStatus("Confirmed"), true);
    assert.equal(isReviewableStatus("Submitted"), false);
});

test("formatDuplicateWarning lists matching invoice ids and statuses", async () => {
    const { formatDuplicateWarning } = await loadInvoiceReview();
    assert.equal(formatDuplicateWarning([]), "");
    assert.equal(
        formatDuplicateWarning([
            { id: 20, status: "Submitted", invoice_id: "PROJ-0001-120GBP" },
            { id: 21, status: "Waiting for Confirm" },
        ]),
        "PROJ-0001-120GBP (Submitted), #21 (Waiting for Confirm)",
    );
});
