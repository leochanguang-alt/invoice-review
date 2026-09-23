const PARSER_VERSION = 'hsbc-1';

const MONTHS = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function normalizeSpaces(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

function parseAmount(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/,/g, '').replace(/[^\d.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function parseHsbcDate(token) {
    // "28 Jul 26" or "01 Aug 26"
    const m = String(token).match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/);
    if (!m) return null;
    const day = String(m[1]).padStart(2, '0');
    const mon = MONTHS[m[2]];
    if (!mon) return null;
    const year = 2000 + Number(m[3]);
    return `${year}-${String(mon).padStart(2, '0')}-${day}`;
}

function extractHeader(lines) {
    let cardLast4 = null;
    let statementDate = null;
    let previousBalance = null;
    let debits = null;
    let credits = null;
    let newBalance = null;

    for (const line of lines) {
        const text = normalizeSpaces(line.text);

        const dateMatch = text.match(/Statement Date\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
        if (dateMatch) {
            const d = new Date(dateMatch[1]);
            if (!Number.isNaN(d.getTime())) {
                statementDate = d.toISOString().slice(0, 10);
            }
        }

        // Card number like 5434 5823 1755 1374
        const cardMatch = text.match(/\b(\d{4})\s+(\d{4})\s+(\d{4})\s+(\d{4})\b/);
        if (cardMatch && !cardLast4) {
            cardLast4 = cardMatch[4];
        }

        const prev = text.match(/Previous Balance\s+([\d,]+\.\d{2})(CR)?/i);
        if (prev) previousBalance = parseAmount(prev[1]) * (prev[2] ? -1 : 1);

        const deb = text.match(/Debits\s+([\d,]+\.\d{2})/i);
        if (deb) debits = parseAmount(deb[1]);

        const cre = text.match(/Credits\s+([\d,]+\.\d{2})/i);
        if (cre) credits = parseAmount(cre[1]);

        const nb = text.match(/New Balance\s+([\d,]+\.\d{2})(CR)?/i);
        if (nb) newBalance = parseAmount(nb[1]) * (nb[2] ? -1 : 1);
    }

    return { cardLast4, statementDate, previousBalance, debits, credits, newBalance };
}

const TX_RE = /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+(.+?)\s+([\d,]+\.\d{2})(CR)?$/;
const FX_RE = /^([\d,]+\.\d{2})\s+([A-Z]{3})@([\d.]+)$/;
const FEE_RE = /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+NON-STERLING TRANSACTION FEE\s+([\d,]+\.\d{2})$/i;

/**
 * Parse HSBC Premier credit card statement lines.
 * @param {Array<{ text: string }>} lines
 */
export function parseHsbcLines(lines) {
    const header = extractHeader(lines);
    const transactions = [];
    const warnings = [];
    let inDetails = false;

    for (let i = 0; i < lines.length; i++) {
        const text = normalizeSpaces(lines[i].text);

        if (/Your Transaction Details/i.test(text) || (/Received By Us/i.test(text) && /Transaction Date/i.test(text))) {
            inDetails = true;
            continue;
        }
        if (!inDetails) continue;

        if (/Summary Of Interest/i.test(text) || /NO INTEREST CHARGED/i.test(text) || /Summary Box/i.test(text)) {
            inDetails = false;
            continue;
        }
        if (/Sheet number/i.test(text) || /Statement Date/i.test(text) || /Card number/i.test(text)) continue;
        if (/MasterCard Exchange Rate/i.test(text)) continue;

        const feeMatch = text.match(FEE_RE);
        if (feeMatch) {
            const postingDate = parseHsbcDate(feeMatch[1]);
            const txnDate = parseHsbcDate(feeMatch[2]);
            const amount = parseAmount(feeMatch[3]);
            transactions.push({
                seq: transactions.length + 1,
                txn_date: txnDate,
                posting_date: postingDate,
                card_last4: header.cardLast4,
                description: 'NON-STERLING TRANSACTION FEE',
                direction: 'debit',
                txn_currency: 'GBP',
                txn_amount: amount,
                posting_currency: 'GBP',
                posting_amount: amount,
                fx_rate: null,
                is_fee: true,
                raw_text: text,
            });
            continue;
        }

        const fxMatch = text.match(FX_RE);
        if (fxMatch && transactions.length > 0) {
            const last = transactions[transactions.length - 1];
            if (!last.is_fee && last.txn_currency === 'GBP') {
                last.txn_amount = parseAmount(fxMatch[1]);
                last.txn_currency = fxMatch[2];
                last.fx_rate = Number(fxMatch[3]);
                last.raw_text = `${last.raw_text} | ${text}`;
            }
            continue;
        }

        const txMatch = text.match(TX_RE);
        if (txMatch) {
            const postingDate = parseHsbcDate(txMatch[1]);
            const txnDate = parseHsbcDate(txMatch[2]);
            const description = normalizeSpaces(txMatch[3]);
            const amount = parseAmount(txMatch[4]);
            const isCredit = Boolean(txMatch[5]);

            transactions.push({
                seq: transactions.length + 1,
                txn_date: txnDate,
                posting_date: postingDate,
                card_last4: header.cardLast4,
                description,
                direction: isCredit ? 'credit' : 'debit',
                txn_currency: 'GBP',
                txn_amount: amount,
                posting_currency: 'GBP',
                posting_amount: amount,
                fx_rate: null,
                is_fee: false,
                raw_text: text,
            });
        }
    }

    const totalDebit = round2(transactions.filter((t) => t.direction === 'debit').reduce((s, t) => s + (t.posting_amount || 0), 0));
    const totalCredit = round2(transactions.filter((t) => t.direction === 'credit').reduce((s, t) => s + (t.posting_amount || 0), 0));

    if (header.debits != null && Math.abs(totalDebit - header.debits) > 0.05) {
        warnings.push(`Debit total ${totalDebit} != statement Debits ${header.debits}`);
    }
    if (header.credits != null && Math.abs(totalCredit - header.credits) > 0.05) {
        warnings.push(`Credit total ${totalCredit} != statement Credits ${header.credits}`);
    }
    if (transactions.length === 0) {
        warnings.push('No HSBC transactions parsed');
    }

    // Period: approximate from earliest/latest txn, else statement month
    const dates = transactions.map((t) => t.txn_date).filter(Boolean).sort();
    const periodStart = dates[0] || header.statementDate;
    const periodEnd = dates[dates.length - 1] || header.statementDate;

    return {
        bank: 'HSBC',
        account_label: header.cardLast4 ? `HSBC ****${header.cardLast4}` : 'HSBC',
        card_last4: header.cardLast4,
        period_start: periodStart,
        period_end: periodEnd,
        statement_date: header.statementDate,
        currency: 'GBP',
        opening_balance: header.previousBalance,
        closing_balance: header.newBalance,
        total_debit: totalDebit,
        total_credit: totalCredit,
        parser_version: PARSER_VERSION,
        transactions,
        warnings,
        summary: {
            statement_debits: header.debits,
            statement_credits: header.credits,
        },
    };
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const HSBC_PARSER_VERSION = PARSER_VERSION;
