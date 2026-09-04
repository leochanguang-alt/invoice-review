import assert from "node:assert/strict";
import test from "node:test";

import {
    applyInvoiceSequenceInvariant,
    mapInvoiceSequenceFields,
} from "../lib/invoice-update-invariants.js";

test("maps direct and frontend invoice sequence fields without dropping explicit clears", () => {
    assert.deepEqual(
        mapInvoiceSequenceFields({
            generated_invoice_id: null,
            charge_to_project: "Project-B",
        }),
        {
            generated_invoice_id: null,
            charge_to_project: "Project-B",
        },
    );
    assert.deepEqual(
        mapInvoiceSequenceFields({
            "Invoice ID": "",
            "Charge to Project": null,
        }),
        {
            generated_invoice_id: "",
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
            status: "waiting for confirm",
            project_sequence: null,
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
