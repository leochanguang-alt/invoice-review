import assert from "node:assert/strict";
import test from "node:test";

import {
    applyInvoiceSequenceInvariant,
    mapInvoiceSequenceFields,
    validateInvoiceProjectChange,
} from "../lib/invoice-update-invariants.js";

test("maps project changes but rejects all client invoice ID field names", () => {
    assert.deepEqual(
        mapInvoiceSequenceFields({
            generated_invoice_id: null,
            charge_to_project: "Project-B",
            "Invoice ID": "FORGED-1",
            Invoice_ID: "FORGED-2",
        }),
        {
            charge_to_project: "Project-B",
        },
    );
    assert.deepEqual(
        mapInvoiceSequenceFields({
            "Invoice ID": "",
            "Charge to Project": null,
        }),
        {
            charge_to_project: null,
        },
    );
});

test("clears project sequence when generated invoice ID is explicitly cleared", () => {
    assert.deepEqual(
        applyInvoiceSequenceInvariant(
            { generated_invoice_id: null, status: "waiting for confirm" },
            { charge_to_project: "Project-A" },
        ),
        {
            generated_invoice_id: null,
            status: "Waiting for Confirm",
            project_sequence: null,
            achieved_file_id: null,
            achieved_file_link: null,
        },
    );
    assert.deepEqual(
        applyInvoiceSequenceInvariant(
            { generated_invoice_id: "" },
            { charge_to_project: "Project-A" },
        ),
        {
            generated_invoice_id: null,
            project_sequence: null,
            achieved_file_id: null,
            achieved_file_link: null,
            status: "Waiting for Confirm",
        },
    );
});

test("clears project sequence when charge-to project changes", () => {
    assert.deepEqual(
        applyInvoiceSequenceInvariant(
            { charge_to_project: "Project-B" },
            {
                charge_to_project: "Project-A",
                project_sequence: 7,
                generated_invoice_id: "Project-A-0007-10EUR",
                achieved_file_id: "projects/Project-A/invoice.pdf",
            },
        ),
        {
            charge_to_project: "Project-B",
            project_sequence: null,
            generated_invoice_id: null,
            achieved_file_id: null,
            achieved_file_link: null,
            status: "Waiting for Confirm",
        },
    );
});

test("preserves confirm status when an unnumbered unarchived invoice changes project", () => {
    assert.deepEqual(
        applyInvoiceSequenceInvariant(
            { charge_to_project: "Project-B", status: "Confirmed" },
            {
                charge_to_project: "Project-A",
                project_sequence: null,
                generated_invoice_id: null,
                achieved_file_id: null,
                achieved_file_link: null,
            },
        ),
        { charge_to_project: "Project-B", status: "Confirmed" },
    );
});

test("rejects clearing the project from a numbered or archived invoice", () => {
    assert.deepEqual(
        validateInvoiceProjectChange(
            { charge_to_project: "" },
            {
                charge_to_project: "Project-A",
                generated_invoice_id: "Project-A-0007-10EUR",
            },
        ),
        {
            valid: false,
            message: "Charge to project cannot be cleared after invoice numbering or archiving",
        },
    );
    assert.deepEqual(
        validateInvoiceProjectChange(
            { charge_to_project: null },
            {
                charge_to_project: "Project-A",
                achieved_file_link: "https://files.example/invoice.pdf",
            },
        ),
        {
            valid: false,
            message: "Charge to project cannot be cleared after invoice numbering or archiving",
        },
    );
});

test("preserves project sequence for unrelated updates or an unchanged project", () => {
    assert.deepEqual(
        applyInvoiceSequenceInvariant(
            { vendor: "Updated", charge_to_project: "Project-A" },
            { charge_to_project: "Project-A" },
        ),
        { vendor: "Updated", charge_to_project: "Project-A" },
    );
});
