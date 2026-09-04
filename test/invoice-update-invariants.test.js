import assert from "node:assert/strict";
import test from "node:test";

import {
    applyInvoiceSequenceInvariant,
    mapInvoiceSequenceFields,
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
            { charge_to_project: "Project-A" },
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

test("preserves project sequence for unrelated updates or an unchanged project", () => {
    assert.deepEqual(
        applyInvoiceSequenceInvariant(
            { vendor: "Updated", charge_to_project: "Project-A" },
            { charge_to_project: "Project-A" },
        ),
        { vendor: "Updated", charge_to_project: "Project-A" },
    );
});
