import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readApi = name => readFile(new URL(`../api/${name}`, import.meta.url), "utf8");

test("confirm applies the shared sequence invariant when project input is present", async () => {
    const source = await readApi("confirm.js");

    assert.match(source, /applyInvoiceSequenceInvariant/);
    assert.match(source, /select\([^)]*charge_to_project[^)]*\)/);
    assert.match(
        source,
        /hasOwnProperty\.call\(body,\s*['"]chargeToProject['"]\)[\s\S]*applyInvoiceSequenceInvariant/,
    );
    assert.match(
        source,
        /hasOwnProperty\.call\(body,\s*['"]chargeToProject['"]\)[\s\S]*Charge to project cannot be empty/,
    );
    assert.match(
        source,
        /updates\.status\s*===\s*['"]Waiting for Confirm['"][\s\S]*json\(res,\s*409,[\s\S]*status:\s*updates\.status/,
    );
});

test("submit conditionally finalizes the exact reserved invoice", async () => {
    const source = await readApi("submit.js");

    assert.match(
        source,
        /\.update\(updateData\)[\s\S]*\.eq\(['"]id['"],\s*recordId\)[\s\S]*\.eq\(['"]generated_invoice_id['"],\s*invoiceId\)[\s\S]*\.select\(['"]id['"]\)/,
    );
    assert.match(source, /requireSingleSubmittedUpdate/);
    assert.match(source, /buildSubmitMessage\(results\)/);
});

test("manage sequence lookup excludes deleted rows and rejects a missing row", async () => {
    const source = await readApi("manage.js");

    assert.match(
        source,
        /\.select\(\s*['"][^'"]*charge_to_project[^'"]*generated_invoice_id[^'"]*achieved_file_id[^'"]*achieved_file_link[^'"]*['"]\s*,?\s*\)[\s\S]*\.eq\(['"]id['"],\s*recordId\)[\s\S]*\.is\(['"]deleted_at['"],\s*null\)[\s\S]*\.maybeSingle\(\)/,
    );
    assert.match(source, /if\s*\(\s*!currentInvoice\s*\)[\s\S]*Record not found/);
    assert.match(
        source,
        /validateInvoiceProjectChange\(\s*updateData,\s*currentInvoice,?\s*\)[\s\S]*json\(res,\s*409/,
    );
    assert.match(source, /invoiceUpdateRequiresReset/);
    assert.match(
        source,
        /sequenceReset[\s\S]*code:\s*["']INVOICE_SEQUENCE_RESET["'][\s\S]*archiveRetained/s,
    );
});

test("manage rejects ambiguous generated invoice IDs without using single or bulk updating", async () => {
    const source = await readApi("manage.js");
    const rejectStart = source.indexOf('if (action === "reject-invoices")');
    const rejectBlock = source.slice(
        rejectStart,
        source.indexOf("const tableName = TABLE_MAP[tableKey]", rejectStart),
    );

    assert.doesNotMatch(
        rejectBlock,
        /\.eq\(['"]generated_invoice_id['"],\s*invoiceId\)[\s\S]*\.single\(\)/,
    );
    assert.match(
        rejectBlock,
        /\.eq\(['"]generated_invoice_id['"],\s*invoiceId\)[\s\S]*\.limit\(2\)/,
    );
    assert.match(rejectBlock, /invoices\.length\s*!==\s*1|ambiguous/i);
    assert.match(rejectBlock, /\.eq\(['"]id['"],\s*invoice\.id\)/);
});

test("frontend warns after a successful sequence reset and exports only real archive paths", async () => {
    const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

    assert.match(source, /json\.sequenceReset[\s\S]*alert\(/s);
    assert.match(source, /result\.json\.sequenceReset[\s\S]*alert\(/s);

    const exportBlock = source.slice(
        source.indexOf("async function executeExport()"),
        source.indexOf("function generateCSV"),
    );
    assert.match(exportBlock, /missing archived file path|missing archive/i);
    assert.doesNotMatch(
        exportBlock,
        /generatedInvoiceId[\s\S]*bui_invoice\/projects\/\$\{projectCode\}/,
    );
    assert.doesNotMatch(exportBlock, /Fallback: Generate expected R2 path/i);
});
