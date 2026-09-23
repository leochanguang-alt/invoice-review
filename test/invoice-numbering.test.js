import assert from "node:assert/strict";
import test from "node:test";
import {
    buildRenumberManifest,
    extensionFromOldKey,
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

test("sorts null invoice dates last, including after real 9999-12-31", () => {
    const manifest = buildRenumberManifest([
        { id: 1, invoice_date: null, amount: 1, currency: "GBP", achieved_file_id: "old/d.pdf" },
        { id: 100, invoice_date: "9999-12-31", amount: 1, currency: "GBP", achieved_file_id: "old/a.pdf" },
        { id: 50, invoice_date: "2026-08-01", amount: 1, currency: "GBP", achieved_file_id: "old/b.pdf" },
        { id: 2, invoice_date: "", amount: 1, currency: "GBP", achieved_file_id: "old/c.pdf" },
    ], "P");
    assert.deepEqual(manifest.map(item => item.invoiceId), [50, 100, 1, 2]);
});

test("assigns 35 contiguous unique sequence numbers", () => {
    const invoices = Array.from({ length: 35 }, (_, index) => ({
        id: 35 - index,
        invoice_date: `2026-01-${String(index + 1).padStart(2, "0")}`,
        amount: index + 1,
        currency: "EUR",
        achieved_file_id: `old/${index}.pdf`,
    }));
    const manifest = buildRenumberManifest(invoices, "Proj");
    const sequences = manifest.map(item => item.sequence);
    assert.deepEqual(sequences, Array.from({ length: 35 }, (_, index) => index + 1));
    assert.equal(new Set(sequences).size, 35);
});

test("builds newKey using extension from the last path segment only", () => {
    const manifest = buildRenumberManifest([
        {
            id: 1,
            invoice_date: "2026-08-01",
            amount: 10,
            currency: "EUR",
            achieved_file_id: "archive/nested.pdf/not-really.pdf/file",
        },
        {
            id: 2,
            invoice_date: "2026-08-02",
            amount: 5,
            currency: "SEK",
            achieved_file_id: "folder.backup/invoice.xlsx",
        },
        {
            id: 3,
            invoice_date: "2026-08-03",
            amount: 7,
            currency: "GBP",
            achieved_file_id: "folder.pdf/actual.pdf",
        },
    ], "Neoss-MoEx-2608");
    assert.equal(
        manifest[0].newKey,
        `bui_invoice/projects/Neoss-MoEx-2608/${manifest[0].generatedInvoiceId}.pdf`,
    );
    assert.equal(
        manifest[1].newKey,
        `bui_invoice/projects/Neoss-MoEx-2608/${manifest[1].generatedInvoiceId}.xlsx`,
    );
    assert.equal(
        manifest[2].newKey,
        `bui_invoice/projects/Neoss-MoEx-2608/${manifest[2].generatedInvoiceId}.pdf`,
    );
});

test("extracts an extension from the basename after removing URL query and fragment", () => {
    assert.equal(
        extensionFromOldKey("folder.with.dot/invoice.final.PDF?token=a.b#page=2"),
        ".PDF",
    );
    assert.equal(extensionFromOldKey("folder.pdf/no-extension?token=.jpg"), ".pdf");
});

test("preserves a '#' inside the basename (R2 keys legitimately contain '#')", () => {
    // Regression: "Receipt from Mouse Tail Coffee #Hfu2.pdf" must keep its .pdf
    // extension. Previously split(/[?#]/) cut the key at '#' and defaulted to .pdf
    // only by luck; a .jpg with '#' would have been mis-detected as .pdf.
    assert.equal(
        extensionFromOldKey("bui_invoice/original_files/fr_google_drive/Receipt from Mouse Tail Coffee #Hfu2.pdf"),
        ".pdf",
    );
    assert.equal(
        extensionFromOldKey("bui_invoice/original_files/fr_google_drive/Receipt from Mouse Tail Coffee #Hfu2.jpg"),
        ".jpg",
    );
});
