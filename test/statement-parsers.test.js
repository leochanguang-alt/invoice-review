import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { detectBank } from '../lib/statement-parsers/detect.js';
import { parseBcmLines } from '../lib/statement-parsers/bcm.js';
import { parseHsbcLines } from '../lib/statement-parsers/hsbc.js';
import { parseRevolutLines } from '../lib/statement-parsers/revolut.js';

async function loadFixture(key) {
    const lines = JSON.parse(await readFile(new URL(`./fixtures/statements/${key}.lines.json`, import.meta.url), 'utf8'));
    const expected = JSON.parse(await readFile(new URL(`./fixtures/statements/${key}.expected.json`, import.meta.url), 'utf8'));
    return { lines, expected };
}

test('detectBank recognizes BCM, HSBC, Revolut', () => {
    assert.equal(detectBank('交通银行个人信用卡 Statement Cycle 账单周期'), 'BCM');
    assert.equal(detectBank('Your HSBC Premier Credit Card Statement Your Transaction Details'), 'HSBC');
    assert.equal(detectBank('Revolut Bank UK Ltd IBAN GB90REVO00997012870259'), 'REVOLUT');
    assert.equal(detectBank('招商银行信用卡'), null);
});

test('BCM 1352 parses FX credits and GBP debit', async () => {
    const { lines, expected } = await loadFixture('bcm-1352');
    const parsed = parseBcmLines(lines);
    assert.equal(parsed.bank, 'BCM');
    assert.equal(parsed.tx_count ?? parsed.transactions.length, expected.tx_count);
    assert.equal(parsed.transactions.length, 5);
    assert.equal(parsed.total_debit, expected.total_debit);
    assert.equal(parsed.total_credit, expected.total_credit);

    const chf = parsed.transactions.find((t) => t.txn_currency === 'CHF' && t.posting_currency === 'USD');
    assert.ok(chf);
    assert.equal(chf.txn_amount, 654.8);
    assert.equal(chf.posting_amount, 811.4);
    assert.equal(chf.direction, 'credit');

    const gbp = parsed.transactions.find((t) => t.txn_currency === 'GBP');
    assert.ok(gbp);
    assert.equal(gbp.posting_currency, 'USD');
    assert.equal(gbp.txn_amount, 29.9);
});

test('BCM 7761 parses domestic CNY spend and repayments', async () => {
    const { lines, expected } = await loadFixture('bcm-7761');
    const parsed = parseBcmLines(lines);
    assert.equal(parsed.transactions.length, expected.tx_count);
    assert.equal(parsed.card_last4, '7761');
    assert.ok(parsed.transactions.some((t) => t.direction === 'debit' && t.posting_currency === 'CNY'));
    assert.ok(parsed.transactions.some((t) => /还款/.test(t.description)));
});

test('HSBC parses SEK FX lines and non-sterling fees', async () => {
    const { lines, expected } = await loadFixture('hsbc-1374');
    const parsed = parseHsbcLines(lines);
    assert.equal(parsed.transactions.length, expected.tx_count);
    assert.equal(parsed.total_debit, 3546.12);
    assert.equal(parsed.total_credit, 183);
    assert.equal(parsed.warnings.length, 0);

    const sek = parsed.transactions.find((t) => t.txn_currency === 'SEK' && t.txn_amount === 310);
    assert.ok(sek);
    assert.equal(sek.posting_currency, 'GBP');
    assert.equal(sek.posting_amount, 24.2);
    assert.ok(sek.fx_rate);

    const fees = parsed.transactions.filter((t) => t.is_fee);
    assert.ok(fees.length >= 3);
    assert.ok(fees.every((t) => t.description.includes('NON-STERLING')));
});

test('Revolut parses multi-currency sections with GBP totals matching summary', async () => {
    const { lines, expected } = await loadFixture('revolut-aug');
    const parsed = parseRevolutLines(lines);
    assert.equal(parsed.transactions.length, expected.tx_count);
    assert.equal(parsed.warnings.length, 0);

    const gbpDebit = parsed.transactions
        .filter((t) => t.direction === 'debit' && t.posting_currency === 'GBP')
        .reduce((s, t) => s + t.posting_amount, 0);
    assert.ok(Math.abs(gbpDebit - 105.65) < 0.01);

    const uber = parsed.transactions.find((t) => /Uber/i.test(t.description) && t.posting_currency === 'GBP');
    assert.ok(uber);
    assert.equal(uber.txn_currency, 'SEK');
    assert.equal(uber.txn_amount, 582);
    assert.equal(uber.posting_amount, 45.16);

    const exchange = parsed.transactions.find((t) => /Exchanged to GBP/i.test(t.description));
    assert.ok(exchange);
    assert.equal(exchange.direction, 'credit');
    assert.equal(exchange.txn_currency, 'USD');
    assert.equal(exchange.txn_amount, 135.35);
});
