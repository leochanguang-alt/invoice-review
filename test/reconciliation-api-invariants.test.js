import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readManage = () => readFile(new URL('../api/manage.js', import.meta.url), 'utf8');
const readReconApi = () => readFile(new URL('../lib/reconciliation-api.js', import.meta.url), 'utf8');
const readServer = () => readFile(new URL('../server.js', import.meta.url), 'utf8');
const readApp = () => readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('manage.js mounts recon_* actions without a new serverless function', async () => {
    const source = await readManage();
    assert.match(source, /handleReconciliationAction/);
    assert.match(source, /recon_/);
});

test('reconciliation API enforces hash/period dedupe and 1:1 match conflict', async () => {
    const source = await readReconApi();
    assert.match(source, /file_hash/);
    assert.match(source, /bank_period|period_start/);
    assert.match(source, /statusCode = 409|json\(res, 409/);
    assert.match(source, /Invoice already reconciled/);
    assert.match(source, /matched_invoice_id: null/);
    assert.match(source, /reconciled_at: null/);
    assert.match(source, /bank_transaction_id: null/);
});

test('server allows larger JSON body for PDF base64 upload', async () => {
    const source = await readServer();
    assert.match(source, /express\.json\(\{\s*limit:\s*['"]10mb['"]\s*\}\)/);
});

test('reconciliation page wires navigation and local match update', async () => {
    const source = await readApp();
    assert.match(source, /showReconciliationPage/);
    assert.match(source, /recon_match/);
    assert.match(source, /reconTransactions\[idx\]/);
    assert.doesNotMatch(
        source.slice(source.indexOf('async function matchReconTransaction'), source.indexOf('async function unmatchReconTransaction')),
        /loadReconTransactions\(/,
    );
});
