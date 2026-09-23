const PARSER_VERSION = 'revolut-1';

const MONTHS = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const CURRENCY_SYMBOLS = {
    '£': 'GBP',
    '$': 'USD',
    '€': 'EUR',
    '¥': 'JPY',
    'AU$': 'AUD',
};

const SECTION_RE = /\b(GBP|HKD|SEK|EUR|CHF|CAD|AUD|USD|DKK|JPY|NOK|PLN|SGD|NZD)\s+Statement\b/i;

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

function parseRevolutDate(token) {
    const m = String(token).match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return null;
    const mon = MONTHS[m[2]] || MONTHS[m[2].slice(0, 3)];
    if (!mon) return null;
    return `${m[3]}-${String(mon).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function moneyToken(str) {
    const s = normalizeSpaces(str);
    const withSym = s.match(/^(AU\$|[£$€¥])\s*([\d,]+\.\d{2})$/);
    if (withSym) {
        return { currency: CURRENCY_SYMBOLS[withSym[1]], amount: parseAmount(withSym[2]) };
    }
    const withCode = s.match(/^([\d,]+\.\d{2})\s+([A-Z]{3})$/);
    if (withCode) {
        return { currency: withCode[2], amount: parseAmount(withCode[1]) };
    }
    return null;
}

function extractGlobalHeader(lines) {
    let iban = null;
    let statementDate = null;

    for (const line of lines) {
        const text = normalizeSpaces(line.text);
        const ibanMatch = text.match(/\b(GB\d{2}[A-Z]{4}\d{14})\b/);
        if (ibanMatch) iban = ibanMatch[1];

        const gen = text.match(/Generated on the\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
        if (gen) statementDate = parseRevolutDate(gen[1]);
    }

    if (!iban) {
        const full = lines.map((l) => l.text).join(' ').replace(/\s+/g, '');
        const m = full.match(/(GB\d{2}[A-Z]{4}\d{14})/i);
        if (m) iban = m[1];
    }

    return {
        iban,
        cardLast4: iban ? iban.slice(-4) : null,
        statementDate,
    };
}

function extractSectionSummary(text, sectionCurrency) {
    // Account (Current Account) £6.93 £105.65 £100.00 £1.28
    // or ... 0.00 SEK 13,262.48 SEK ...
    const amounts = [];
    const symRe = /(?:AU\$|[£$€¥])\s*([\d,]+\.\d{2})/g;
    let m;
    while ((m = symRe.exec(text))) amounts.push(parseAmount(m[1]));
    if (amounts.length < 4) {
        const codeRe = new RegExp(`([\\d,]+\\.\\d{2})\\s+${sectionCurrency}`, 'gi');
        while ((m = codeRe.exec(text))) amounts.push(parseAmount(m[1]));
    }
    if (amounts.length >= 4) {
        return {
            opening: amounts[0],
            moneyOut: amounts[1],
            moneyIn: amounts[2],
            closing: amounts[3],
        };
    }
    return null;
}

const DATE_START_RE = /^(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b(.*)$/;

/**
 * Parse Revolut multi-currency account statement.
 * Each "XXX Statement" section contributes transactions in that posting currency.
 */
export function parseRevolutLines(lines) {
    const header = extractGlobalHeader(lines);
    const transactions = [];
    const warnings = [];
    const sectionSummaries = {};

    let sectionCurrency = null;
    let inTxSection = false;
    let periodStart = null;
    let periodEnd = null;
    let current = null;
    let xMoneyOut = null;
    let xMoneyIn = null;
    let xBalance = null;

    function flush() {
        if (!current) return;
        if (current.posting_amount == null && current.txn_amount == null) {
            current = null;
            return;
        }
        if (current.posting_amount == null) current.posting_amount = current.txn_amount;
        if (current.txn_amount == null) current.txn_amount = current.posting_amount;
        transactions.push({
            seq: transactions.length + 1,
            txn_date: current.txn_date,
            posting_date: current.posting_date,
            card_last4: current.card_last4 || header.cardLast4,
            description: current.description,
            direction: current.direction,
            txn_currency: current.txn_currency,
            txn_amount: current.txn_amount,
            posting_currency: current.posting_currency,
            posting_amount: current.posting_amount,
            fx_rate: current.fx_rate,
            is_fee: false,
            raw_text: current.raw_text,
        });
        current = null;
    }

    function classifyMoneyItems(items, fallbackCurrency) {
        const moneys = [];
        for (const it of items || []) {
            const tok = moneyToken(it.str);
            if (tok) moneys.push({ ...tok, x: it.x });
        }
        // Adjacent symbol + amount
        if (items) {
            for (let i = 0; i < items.length - 1; i++) {
                const sym = items[i].str.trim();
                const amt = items[i + 1].str.trim();
                if (CURRENCY_SYMBOLS[sym] && /^[\d,]+\.\d{2}$/.test(amt)) {
                    const already = moneys.some((m) => Math.abs(m.x - items[i].x) < 2 && m.amount === parseAmount(amt));
                    if (!already) {
                        moneys.push({ currency: CURRENCY_SYMBOLS[sym], amount: parseAmount(amt), x: items[i].x });
                    }
                }
                // "139.97" + "HKD"
                if (/^[\d,]+\.\d{2}$/.test(sym) && /^[A-Z]{3}$/.test(amt)) {
                    moneys.push({ currency: amt, amount: parseAmount(sym), x: items[i].x });
                }
            }
        }

        let moneyOut = null;
        let moneyIn = null;
        let balance = null;
        const extras = [];

        for (const m of moneys) {
            if (xBalance != null && m.x >= xBalance - 15) {
                balance = m;
                continue;
            }
            if (xMoneyIn != null && m.x >= xMoneyIn - 15 && (xBalance == null || m.x < xBalance - 15)) {
                if (!moneyIn) moneyIn = m;
                else extras.push(m);
                continue;
            }
            if (xMoneyOut != null && m.x >= xMoneyOut - 15 && (xMoneyIn == null || m.x < xMoneyIn - 15)) {
                if (!moneyOut) moneyOut = m;
                else extras.push(m);
                continue;
            }
            extras.push(m);
        }

        if (!moneyOut && !moneyIn && moneys.length) {
            const ordered = moneys.slice().sort((a, b) => a.x - b.x);
            if (ordered.length === 1) moneyOut = ordered[0];
            else {
                moneyOut = ordered[0];
                balance = ordered[ordered.length - 1];
                if (ordered.length >= 3) moneyIn = ordered[1];
            }
        }

        return { moneyOut, moneyIn, balance, extras, fallbackCurrency };
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const text = normalizeSpaces(line.text);

        const sectionMatch = text.match(SECTION_RE);
        if (sectionMatch) {
            const nextCurrency = sectionMatch[1].toUpperCase();
            // Continuation pages repeat "GBP Statement" — keep the open tx section.
            if (nextCurrency !== sectionCurrency) {
                flush();
                sectionCurrency = nextCurrency;
                inTxSection = false;
                xMoneyOut = xMoneyIn = xBalance = null;
            } else if (!sectionCurrency) {
                sectionCurrency = nextCurrency;
            }
            continue;
        }

        if (/PERSONAL ACCOUNT MIGRATION/i.test(text)) {
            flush();
            inTxSection = false;
            continue;
        }

        if (/Account \(Current Account\)/i.test(text) || (/^Total\b/i.test(text) && sectionCurrency)) {
            const summary = extractSectionSummary(text, sectionCurrency || 'GBP');
            if (summary && sectionCurrency) {
                sectionSummaries[sectionCurrency] = summary;
            }
        }

        const periodMatch = text.match(/Account transactions from\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
        if (periodMatch) {
            flush();
            inTxSection = true;
            const ps = parseRevolutDate(periodMatch[1]);
            const pe = parseRevolutDate(periodMatch[2]);
            if (ps && (!periodStart || ps < periodStart)) periodStart = ps;
            if (pe && (!periodEnd || pe > periodEnd)) periodEnd = pe;
            continue;
        }

        if (/Money out/i.test(text) && /Money in/i.test(text) && line.items) {
            for (const it of line.items) {
                if (/Money out/i.test(it.str)) xMoneyOut = it.x;
                if (/Money in/i.test(it.str)) xMoneyIn = it.x;
                if (/^Balance$/i.test(it.str.trim())) xBalance = it.x;
            }
        }

        if (!inTxSection || !sectionCurrency) continue;

        if (/PERSONAL ACCOUNT MIGRATION/i.test(text) || /Report lost or stolen/i.test(text)) continue;
        if (/^Date\b/i.test(text) && /Description/i.test(text)) continue;
        if (/GBP Statement|SEK Statement|USD Statement|EUR Statement|Generated on the/i.test(text)) continue;
        if (/^Page \d+ of \d+$/i.test(text) || /©\s*\d{4}\s*Revolut/i.test(text)) continue;

        const dateMatch = text.match(DATE_START_RE);
        if (dateMatch && parseRevolutDate(dateMatch[1])) {
            flush();
            const txnDate = parseRevolutDate(dateMatch[1]);
            const classified = classifyMoneyItems(line.items, sectionCurrency);

            let description = normalizeSpaces(dateMatch[2] || '')
                .replace(/(?:AU\$|[£$€¥])\s*[\d,]+\.\d{2}/g, '')
                .replace(/[\d,]+\.\d{2}\s+[A-Z]{3}/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            let direction = 'debit';
            let postingAmount = null;
            let postingCurrency = sectionCurrency;
            let txnAmount = null;
            let txnCurrency = sectionCurrency;

            if (classified.moneyIn && !classified.moneyOut) {
                direction = 'credit';
                postingAmount = classified.moneyIn.amount;
                postingCurrency = classified.moneyIn.currency || sectionCurrency;
                txnAmount = postingAmount;
                txnCurrency = postingCurrency;
                const secondary = classified.extras.find((e) => e.currency && e.currency !== postingCurrency);
                if (secondary) {
                    txnAmount = secondary.amount;
                    txnCurrency = secondary.currency;
                }
            } else if (classified.moneyOut) {
                direction = 'debit';
                postingAmount = classified.moneyOut.amount;
                postingCurrency = classified.moneyOut.currency || sectionCurrency;
                txnAmount = postingAmount;
                txnCurrency = postingCurrency;
                const secondary = classified.extras.find((e) => e.currency && e.currency !== postingCurrency);
                if (secondary) {
                    txnAmount = secondary.amount;
                    txnCurrency = secondary.currency;
                }
            } else {
                // Text fallback within section
                const codeAmts = [...text.matchAll(/([\d,]+\.\d{2})\s+([A-Z]{3})/g)];
                const symAmts = [...text.matchAll(/(?:AU\$|[£$€¥])\s*([\d,]+\.\d{2})/g)];
                if (symAmts.length >= 1) {
                    postingAmount = parseAmount(symAmts[0][1]);
                } else if (codeAmts.length >= 1) {
                    postingAmount = parseAmount(codeAmts[0][1]);
                    postingCurrency = codeAmts[0][2];
                }
                txnAmount = postingAmount;
                txnCurrency = postingCurrency;
                if (/^Exchanged to\b/i.test(description) || /^Payment from\b/i.test(description)) {
                    direction = 'credit';
                }
            }

            current = {
                txn_date: txnDate,
                posting_date: txnDate,
                card_last4: null,
                description,
                direction,
                txn_currency: txnCurrency,
                txn_amount: txnAmount,
                posting_currency: postingCurrency,
                posting_amount: postingAmount,
                fx_rate: null,
                raw_text: text,
            };
            continue;
        }

        if (!current) continue;

        if (/Card:\s*.*(\d{4})\s*$/i.test(text) || /Card:\s*\d+\*+(\d{4})/i.test(text)) {
            const m = text.match(/(\d{4})\s*$/);
            if (m) current.card_last4 = m[1];
            current.raw_text += ` | ${text}`;
            continue;
        }

        if (/^To:/i.test(text) || /^Reference:/i.test(text)) {
            current.description = normalizeSpaces(`${current.description} ${text}`);
            current.raw_text += ` | ${text}`;
            continue;
        }

        if (/Revolut Rate/i.test(text) || /ECB rate/i.test(text)) {
            current.description = normalizeSpaces(`${current.description} ${text}`);
            current.raw_text += ` | ${text}`;
            const rateMatch = text.match(/£1\.00\s*=\s*([\d.]+)\s+([A-Z]{3})/i)
                || text.match(/1\.00\s+[A-Z]{3}\s*=\s*([\d.]+)\s+([A-Z]{3})/i);
            if (rateMatch) current.fx_rate = Number(rateMatch[1]);

            // Prefer explicit "582.00 SEK" over the rate number
            const codeAmts = [...text.matchAll(/([\d,]+\.\d{2})\s+([A-Z]{3})/g)];
            for (const cm of codeAmts) {
                const amt = parseAmount(cm[1]);
                const cur = cm[2];
                // Skip rate-looking small numbers when a larger foreign amount exists on same/next lines
                if (cur !== current.posting_currency) {
                    // Only set if this looks like a principal amount (not the rate multiplier alone)
                    if (current.fx_rate == null || Math.abs(amt - current.fx_rate) > 0.001) {
                        current.txn_amount = amt;
                        current.txn_currency = cur;
                    }
                }
            }
            continue;
        }

        // Standalone secondary currency amount (e.g. "$135.35" or "582.00 SEK")
        const onlyMoney = moneyToken(text);
        if (onlyMoney) {
            if (onlyMoney.currency !== current.posting_currency) {
                current.txn_amount = onlyMoney.amount;
                current.txn_currency = onlyMoney.currency;
            } else if (current.posting_amount == null) {
                current.posting_amount = onlyMoney.amount;
            }
            current.raw_text += ` | ${text}`;
            continue;
        }

        // Money-only continuation with column classification
        if (line.items?.length) {
            const classified = classifyMoneyItems(line.items, sectionCurrency);
            for (const extra of classified.extras) {
                if (extra.currency && extra.currency !== current.posting_currency) {
                    current.txn_amount = extra.amount;
                    current.txn_currency = extra.currency;
                    current.raw_text += ` | ${extra.amount} ${extra.currency}`;
                }
            }
            if (classified.moneyOut && current.direction === 'debit' && current.posting_amount == null) {
                current.posting_amount = classified.moneyOut.amount;
            }
            if (classified.moneyIn && current.direction === 'credit' && current.posting_amount == null) {
                current.posting_amount = classified.moneyIn.amount;
            }
        }
    }
    flush();

    // Validate GBP section totals when available
    const gbpSummary = sectionSummaries.GBP;
    const gbpDebit = round2(transactions.filter((t) => t.direction === 'debit' && t.posting_currency === 'GBP').reduce((s, t) => s + (t.posting_amount || 0), 0));
    const gbpCredit = round2(transactions.filter((t) => t.direction === 'credit' && t.posting_currency === 'GBP').reduce((s, t) => s + (t.posting_amount || 0), 0));

    if (gbpSummary?.moneyOut != null && Math.abs(gbpDebit - gbpSummary.moneyOut) > 0.05) {
        warnings.push(`GBP money out ${gbpDebit} != summary ${gbpSummary.moneyOut}`);
    }
    if (gbpSummary?.moneyIn != null && Math.abs(gbpCredit - gbpSummary.moneyIn) > 0.05) {
        warnings.push(`GBP money in ${gbpCredit} != summary ${gbpSummary.moneyIn}`);
    }
    if (transactions.length === 0) {
        warnings.push('No Revolut transactions parsed');
    }

    const totalDebit = round2(transactions.filter((t) => t.direction === 'debit').reduce((s, t) => s + (t.posting_amount || 0), 0));
    const totalCredit = round2(transactions.filter((t) => t.direction === 'credit').reduce((s, t) => s + (t.posting_amount || 0), 0));

    return {
        bank: 'REVOLUT',
        account_label: header.iban ? `Revolut ${header.iban.slice(-4)}` : 'Revolut',
        card_last4: header.cardLast4,
        period_start: periodStart,
        period_end: periodEnd,
        statement_date: header.statementDate || periodEnd,
        currency: 'GBP',
        opening_balance: gbpSummary?.opening ?? null,
        closing_balance: gbpSummary?.closing ?? null,
        total_debit: totalDebit,
        total_credit: totalCredit,
        parser_version: PARSER_VERSION,
        transactions,
        warnings,
        summary: {
            iban: header.iban,
            sections: sectionSummaries,
            gbp_money_out: gbpSummary?.moneyOut,
            gbp_money_in: gbpSummary?.moneyIn,
        },
    };
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const REVOLUT_PARSER_VERSION = PARSER_VERSION;
