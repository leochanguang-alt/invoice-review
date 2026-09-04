import assert from "node:assert/strict";
import test from "node:test";

import { validateInvoiceProjectDate } from "../lib/project-date-validation.js";

const projectRange = {
    projectStartDate: "2026-08-01",
    projectEndDate: "2026-08-31",
};

test("allows invoice dates on both project boundaries", () => {
    assert.equal(validateInvoiceProjectDate({
        invoiceDate: "2026-08-01",
        ...projectRange,
    }).outOfRange, false);

    assert.equal(validateInvoiceProjectDate({
        invoiceDate: "2026-08-31",
        ...projectRange,
    }).outOfRange, false);
});

test("flags invoice dates before or after the project range", () => {
    assert.deepEqual(validateInvoiceProjectDate({
        invoiceDate: "2026-07-31",
        ...projectRange,
    }), {
        outOfRange: true,
        invoiceDate: "2026-07-31",
        projectStartDate: "2026-08-01",
        projectEndDate: "2026-08-31",
    });

    assert.deepEqual(validateInvoiceProjectDate({
        invoiceDate: "2026-09-01",
        ...projectRange,
    }), {
        outOfRange: true,
        invoiceDate: "2026-09-01",
        projectStartDate: "2026-08-01",
        projectEndDate: "2026-08-31",
    });
});

test("does not block when a date or project boundary is missing or invalid", () => {
    assert.equal(validateInvoiceProjectDate({
        invoiceDate: "2026-09-01",
        projectStartDate: "2026-08-01",
        projectEndDate: null,
    }).outOfRange, false);

    assert.equal(validateInvoiceProjectDate({
        invoiceDate: "not-a-date",
        ...projectRange,
    }).outOfRange, false);
});
