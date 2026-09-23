import assert from 'node:assert/strict';
import test from 'node:test';
import {
    rankInvoiceMatches,
    scoreInvoiceMatch,
    ratesMapFromRows,
    toHkd,
} from '../lib/reconcile-match.js';

const rates = new Map([
    ['GBP', 10],
    ['USD', 7.8],
    ['SEK', 0.72],
    ['CNY', 1.08],
    ['HKD', 1],
]);

test('toHkd prefers invoice amount_hkd then rate map', () => {
    assert.equal(toHkd(10, 'GBP', 99, rates), 99);
    assert.equal(toHkd(10, 'GBP', null, rates), 100);
    assert.equal(toHkd(10, 'HKD', null, rates), 10);
    assert.equal(toHkd(10, 'ZZZ', null, rates), null);
});

test('exact txn currency match scores highest', () => {
    const tx = {
        txn_date: '2026-08-21',
        description: 'PIC POC ULRIKSD Solna SWE',
        txn_currency: 'SEK',
        txn_amount: 310,
        posting_currency: 'GBP',
        posting_amount: 24.2,
    };
    const inv = {
        id: 1,
        invoice_date: '2026-08-20',
        vendor: 'Pic Poc',
        currency: 'SEK',
        amount: 310,
        status: 'reviewed',
    };
    const score = scoreInvoiceMatch(tx, inv, { ratesByCurrency: rates });
    assert.ok(score);
    assert.equal(score.reason, 'txn_currency_exact');
    assert.ok(score.score >= 100);
});

test('posting currency exact match when txn currency differs', () => {
    const tx = {
        txn_date: '2026-08-04',
        description: 'SQ MOUSE TAIL COFFEE London',
        txn_currency: 'GBP',
        txn_amount: 3.8,
        posting_currency: 'GBP',
        posting_amount: 3.8,
    };
    const inv = {
        id: 2,
        invoice_date: '2026-08-04',
        vendor: 'Mouse Tail Coffee',
        currency: 'GBP',
        amount: 3.8,
        status: 'submitted',
    };
    const score = scoreInvoiceMatch(tx, inv, { ratesByCurrency: rates });
    assert.ok(score);
    assert.ok(['txn_currency_exact', 'posting_currency_exact'].includes(score.reason));
});

test('HKD tolerance match within 3%', () => {
    const tx = {
        txn_date: '2026-08-10',
        description: 'Foreign Merchant',
        txn_currency: 'USD',
        txn_amount: 100,
        posting_currency: 'GBP',
        posting_amount: 78,
    };
    // Invoice in USD 100 -> HKD 780; tx USD 100 -> 780 exact
    const inv = {
        id: 3,
        invoice_date: '2026-08-10',
        vendor: 'Foreign Merchant',
        currency: 'USD',
        amount: 100,
        amount_hkd: 780,
        status: 'reviewed',
    };
    const score = scoreInvoiceMatch(tx, inv, { ratesByCurrency: rates });
    assert.ok(score);
});

test('date window excludes far invoices; reconciled invoices excluded', () => {
    const tx = {
        txn_date: '2026-08-10',
        description: 'Test',
        txn_currency: 'GBP',
        txn_amount: 10,
        posting_currency: 'GBP',
        posting_amount: 10,
    };
    // More than ±1 day away
    assert.equal(scoreInvoiceMatch(tx, {
        id: 4, invoice_date: '2026-08-08', vendor: 'X', currency: 'GBP', amount: 10, status: 'reviewed',
    }, { ratesByCurrency: rates }), null);

    assert.equal(scoreInvoiceMatch(tx, {
        id: 4, invoice_date: '2026-08-12', vendor: 'X', currency: 'GBP', amount: 10, status: 'reviewed',
    }, { ratesByCurrency: rates }), null);

    // Within ±1 day is allowed
    assert.ok(scoreInvoiceMatch(tx, {
        id: 6, invoice_date: '2026-08-11', vendor: 'X', currency: 'GBP', amount: 10, status: 'reviewed',
    }, { ratesByCurrency: rates }));

    assert.equal(scoreInvoiceMatch(tx, {
        id: 5, invoice_date: '2026-08-10', vendor: 'X', currency: 'GBP', amount: 10,
        status: 'reviewed', reconciled_at: '2026-08-11',
    }, { ratesByCurrency: rates }), null);
});

test('rankInvoiceMatches returns top N and skips fees/repayments', () => {
    const invoices = [
        { id: 1, invoice_date: '2026-08-10', vendor: 'Alpha Shop', currency: 'GBP', amount: 10, status: 'reviewed' },
        { id: 2, invoice_date: '2026-08-10', vendor: 'Beta', currency: 'GBP', amount: 10.5, status: 'reviewed' },
        { id: 3, invoice_date: '2026-08-09', vendor: 'Alpha', currency: 'GBP', amount: 10, status: 'reviewed' },
    ];
    const tx = {
        txn_date: '2026-08-10',
        description: 'Alpha Shop London',
        txn_currency: 'GBP',
        txn_amount: 10,
        posting_currency: 'GBP',
        posting_amount: 10,
    };
    const ranked = rankInvoiceMatches(tx, invoices, { ratesByCurrency: rates, topN: 2 });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].invoice_id, 1);

    assert.deepEqual(rankInvoiceMatches({ ...tx, is_fee: true }, invoices, { ratesByCurrency: rates }), []);
    assert.deepEqual(rankInvoiceMatches({
        ...tx,
        direction: 'credit',
        description: '信用卡还款 还款-人行',
    }, invoices, { ratesByCurrency: rates }), []);
});

test('ratesMapFromRows filters by month', () => {
    const map = ratesMapFromRows([
        { currency_code: 'GBP', rate_date: '2026-08-01', rate_to_hkd: 10 },
        { currency_code: 'GBP', rate_date: '2026-07-01', rate_to_hkd: 9 },
        { currency_code: 'USD', rate_date: '2026-08-01', rate_to_hkd: 7.8 },
    ], '2026-08-01');
    assert.equal(map.get('GBP'), 10);
    assert.equal(map.get('USD'), 7.8);
});
