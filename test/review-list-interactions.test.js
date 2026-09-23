import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readApp = () => readFile(new URL("../public/app.js", import.meta.url), "utf8");

function functionBlock(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return source.slice(start, end);
}

test("review toggles one row without rebuilding the entire table", async () => {
    const source = await readApp();
    const block = functionBlock(
        source,
        "function toggleReviewed(rowNum)",
        "function clearReviewDetailPanel",
    );

    assert.doesNotMatch(block, /renderReviewRecords\(\)/);
    assert.match(block, /classList\.toggle\(['"]reviewed['"]/);
});

test("delete removes the successful row locally without refetching expenses", async () => {
    const source = await readApp();
    const block = functionBlock(
        source,
        "async function deleteInvoiceRecord",
        "// Render a multi-line summary",
    );

    assert.doesNotMatch(block, /loadReviewRecords\(\)/);
    assert.match(block, /removeReviewRecordsLocally\(/);
});

test("submit removes successful rows locally without refetching expenses", async () => {
    const source = await readApp();
    const block = functionBlock(
        source,
        "async function submitReviewedRecords",
        "window.submitReviewedRecords",
    );

    assert.doesNotMatch(block, /loadReviewRecords\(\)/);
    assert.match(block, /removeReviewRecordsLocally\(/);
});

test("selecting a record only changes selected row classes", async () => {
    const source = await readApp();
    const block = functionBlock(
        source,
        "function selectRecord(idx)",
        "let ownerList",
    );

    assert.doesNotMatch(block, /renderReviewRecords\(\)/);
    assert.match(block, /classList\.toggle\(\s*['"]selected['"]/);
});
