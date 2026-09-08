import assert from "node:assert/strict";
import test from "node:test";

import {
    annotateDuplicates,
    invoicesAreDuplicates,
    isReviewableStatus,
} from "../lib/invoice-duplicates.js";

function invoice(overrides = {}) {
    return {
        _rowNumber: 1,
        Vender: "Uber BV",
        Amount: "120.00",
        Currency: "GBP",
        "Invoice Date": "2026-08-10",
        "Invoice Number": "INV-1",
        Status: "Waiting for Confirm",
        ...overrides,
    };
}

test("treats the same vendor, amount, currency, and date as duplicates", () => {
    assert.equal(
        invoicesAreDuplicates(
            invoice({ _rowNumber: 1 }),
            invoice({ _rowNumber: 2, Status: "Submitted" }),
        ),
        true,
    );
});

test("ignores vendor capitalization and extra whitespace", () => {
    assert.equal(
        invoicesAreDuplicates(
            invoice({ _rowNumber: 1, Vender: "  Uber   BV " }),
            invoice({ _rowNumber: 2, Vender: "uber bv" }),
        ),
        true,
    );
});

test("does not match a record to itself", () => {
    const row = invoice();
    assert.equal(invoicesAreDuplicates(row, row), false);
});

test("does not match different amounts, currencies, or dates", () => {
    assert.equal(
        invoicesAreDuplicates(invoice({ _rowNumber: 1 }), invoice({ _rowNumber: 2, Amount: "121" })),
        false,
    );
    assert.equal(
        invoicesAreDuplicates(invoice({ _rowNumber: 1 }), invoice({ _rowNumber: 2, Currency: "HKD" })),
        false,
    );
    assert.equal(
        invoicesAreDuplicates(
            invoice({ _rowNumber: 1 }),
            invoice({ _rowNumber: 2, "Invoice Date": "2026-08-11" }),
        ),
        false,
    );
});

test("requires invoice number only when both records have one", () => {
    assert.equal(
        invoicesAreDuplicates(
            invoice({ _rowNumber: 1, "Invoice Number": "INV-1" }),
            invoice({ _rowNumber: 2, "Invoice Number": "INV-2" }),
        ),
        false,
    );
    assert.equal(
        invoicesAreDuplicates(
            invoice({ _rowNumber: 1, "Invoice Number": "INV-1" }),
            invoice({ _rowNumber: 2, "Invoice Number": "" }),
        ),
        true,
    );
});

test("does not match when vendor, amount, currency, or date is missing", () => {
    assert.equal(
        invoicesAreDuplicates(invoice({ _rowNumber: 1, Vender: "" }), invoice({ _rowNumber: 2 })),
        false,
    );
    assert.equal(
        invoicesAreDuplicates(invoice({ _rowNumber: 1, Amount: "" }), invoice({ _rowNumber: 2 })),
        false,
    );
    assert.equal(
        invoicesAreDuplicates(invoice({ _rowNumber: 1, Currency: "" }), invoice({ _rowNumber: 2 })),
        false,
    );
    assert.equal(
        invoicesAreDuplicates(
            invoice({ _rowNumber: 1, "Invoice Date": "" }),
            invoice({ _rowNumber: 2 }),
        ),
        false,
    );
});

test("annotates each invoice with the other matching records", () => {
    const rows = annotateDuplicates([
        invoice({ _rowNumber: 10, Status: "Waiting for Confirm" }),
        invoice({
            _rowNumber: 20,
            Status: "Submitted",
            "Invoice ID": "PROJ-0001-120GBP",
        }),
        invoice({
            _rowNumber: 30,
            Vender: "Other Cafe",
            Amount: "12",
            Status: "Waiting for Confirm",
        }),
    ]);

    assert.equal(rows[0].duplicate_matches.length, 1);
    assert.deepEqual(rows[0].duplicate_matches[0], {
        id: 20,
        status: "Submitted",
        vendor: "Uber BV",
        amount: "120.00",
        currency: "GBP",
        invoice_date: "2026-08-10",
        invoice_number: "INV-1",
        invoice_id: "PROJ-0001-120GBP",
    });
    assert.equal(rows[1].duplicate_matches.length, 1);
    assert.equal(rows[1].duplicate_matches[0].id, 10);
    assert.deepEqual(rows[2].duplicate_matches, []);
});

test("isReviewableStatus keeps waiting and confirmed invoices", () => {
    assert.equal(isReviewableStatus("Waiting for Confirm"), true);
    assert.equal(isReviewableStatus("confirmed"), true);
    assert.equal(isReviewableStatus("Submitted"), false);
    assert.equal(isReviewableStatus(""), false);
});
