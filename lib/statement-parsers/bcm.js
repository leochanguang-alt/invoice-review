const PARSER_VERSION = 'bcm-1';

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

function resolveYear(mmdd, periodStart, periodEnd) {
    const [mm, dd] = mmdd.split('/').map(Number);
    if (!mm || !dd) return null;
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    // Prefer the year that falls inside (or nearest to) the statement cycle.
    for (const year of [end.getFullYear(), start.getFullYear(), end.getFullYear() - 1]) {
        const candidate = new Date(Date.UTC(year, mm - 1, dd));
        if (candidate >= new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate() - 15))
            && candidate <= new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate() + 15))) {
            return candidate.toISOString().slice(0, 10);
        }
    }
    return `${end.getFullYear()}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function extractHeader(lines) {
    let cardLast4 = null;
    let periodStart = null;
    let periodEnd = null;
    let statementDate = null;
    let cnyBalance = null;
    let usdBalance = null;

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i].text;

        const cardMatch = text.match(/(\d{6})\*{4,6}(\d{4})/);
        if (cardMatch && !cardLast4) {
            cardLast4 = cardMatch[2];
        }

        const periodMatch = text.match(/(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d{4})\/(\d{2})\/(\d{2})/);
        if (periodMatch) {
            periodStart = `${periodMatch[1]}-${periodMatch[2]}-${periodMatch[3]}`;
            periodEnd = `${periodMatch[4]}-${periodMatch[5]}-${periodMatch[6]}`;
        }

        // Email subject / header often has "2026年09月"
        if (!statementDate) {
            const ym = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
            if (ym && (text.includes('电子账单') || text.includes('电⼦账单') || text.includes('信用卡'))) {
                const y = ym[1];
                const m = String(ym[2]).padStart(2, '0');
                statementDate = `${y}-${m}-01`;
            }
        }

        if (text.includes('本期应还款') || text.includes('Statement Balance')) {
            // Look nearby for ¥ and ＄ amounts
            const window = lines.slice(i, i + 4).map((l) => l.text).join(' ');
            const cny = window.match(/¥\s*([-]?[\d,]+\.?\d*)/);
            const usd = window.match(/[＄$]\s*([-]?[\d,]+\.?\d*)/);
            if (cny) cnyBalance = parseAmount(cny[1]);
            if (usd) usdBalance = parseAmount(usd[1]);
        }
    }

    if (periodEnd && !statementDate) statementDate = periodEnd;

    return { cardLast4, periodStart, periodEnd, statementDate, cnyBalance, usdBalance };
}

const CURRENCY_RE = /^(CNY|USD|HKD|EUR|GBP|JPY|CHF|SEK|DKK|NOK|SGD|AUD|CAD|NZD|THB|KRW|TWD|MOP)\s+(CNY|USD|HKD|EUR|GBP|JPY|CHF|SEK|DKK|NOK|SGD|AUD|CAD|NZD|THB|KRW|TWD|MOP)$/;
const DATE_ROW_RE = /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(\d{4})\s+(.+)$/;
const AMOUNT_ROW_RE = /^([-]?[\d,]+\.\d{2})\s+([-]?[\d,]+\.\d{2})$/;

/**
 * Parse BCM (Bank of Communications) credit card statement lines.
 * @param {Array<{ text: string, items?: any[] }>} lines
 */
export function parseBcmLines(lines) {
    const header = extractHeader(lines);
    const transactions = [];
    let section = null; // 'credit' | 'debit'
    let pendingCurrency = null;
    let pendingRow = null;
    let warnings = [];

    for (const line of lines) {
        const text = normalizeSpaces(line.text);

        if (text.includes('还款、退货') || text.includes('费⽤返还明细') || text.includes('费用返还明细')) {
            section = 'credit';
            pendingCurrency = null;
            pendingRow = null;
            continue;
        }
        if (text.includes('消费、取现') || text.includes('其他费⽤明细') || text.includes('其他费用明细')) {
            section = 'debit';
            pendingCurrency = null;
            pendingRow = null;
            continue;
        }
        if (!section) continue;

        // Skip headers / footnotes
        if (
            text.includes('Transaction') ||
            text.includes('Posting') ||
            text.includes('Curr/Amt') ||
            text.includes('Description of Transaction') ||
            text.includes('交易日期') ||
            text.includes('记账日期') ||
            text.includes('卡末') ||
            text.includes('已转分期') ||
            text.includes('账单总额') ||
            /^\d+\s*of\s*\d+$/i.test(text)
        ) {
            continue;
        }

        const currencyMatch = text.match(CURRENCY_RE);
        if (currencyMatch) {
            pendingCurrency = { txn: currencyMatch[1], posting: currencyMatch[2] };
            continue;
        }

        const dateMatch = text.match(DATE_ROW_RE);
        if (dateMatch && header.periodStart && header.periodEnd) {
            pendingRow = {
                txnMmDd: dateMatch[1],
                postingMmDd: dateMatch[2],
                cardLast4: dateMatch[3],
                description: normalizeSpaces(dateMatch[4]),
            };
            continue;
        }

        const amountMatch = text.match(AMOUNT_ROW_RE);
        if (amountMatch && pendingRow && pendingCurrency && section) {
            const txnAmount = Math.abs(parseAmount(amountMatch[1]));
            const postingAmount = Math.abs(parseAmount(amountMatch[2]));
            const txnDate = resolveYear(pendingRow.txnMmDd, header.periodStart, header.periodEnd);
            const postingDate = resolveYear(pendingRow.postingMmDd, header.periodStart, header.periodEnd);

            transactions.push({
                seq: transactions.length + 1,
                txn_date: txnDate,
                posting_date: postingDate,
                card_last4: pendingRow.cardLast4,
                description: pendingRow.description,
                direction: section,
                txn_currency: pendingCurrency.txn,
                txn_amount: txnAmount,
                posting_currency: pendingCurrency.posting,
                posting_amount: postingAmount,
                fx_rate: null,
                is_fee: false,
                raw_text: `${pendingCurrency.txn}/${pendingCurrency.posting} ${pendingRow.txnMmDd} ${pendingRow.description} ${txnAmount}/${postingAmount}`,
            });

            pendingRow = null;
            pendingCurrency = null;
        }
    }

    const totalDebit = round2(transactions.filter((t) => t.direction === 'debit').reduce((s, t) => s + (t.posting_amount || 0), 0));
    const totalCredit = round2(transactions.filter((t) => t.direction === 'credit').reduce((s, t) => s + (t.posting_amount || 0), 0));

    // Soft validation against CNY statement balance when present.
    // BCM statement balance can mix CNY/USD ledgers; only warn on empty parse.
    if (transactions.length === 0) {
        warnings.push('No BCM transactions parsed');
    }

    let cardLast4 = header.cardLast4;
    if (!cardLast4 || cardLast4 === 'XXXX') {
        const counts = new Map();
        for (const t of transactions) {
            if (!t.card_last4) continue;
            counts.set(t.card_last4, (counts.get(t.card_last4) || 0) + 1);
        }
        cardLast4 = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || cardLast4;
    }

    return {
        bank: 'BCM',
        account_label: cardLast4 ? `BCM ****${cardLast4}` : 'BCM',
        card_last4: cardLast4,
        period_start: header.periodStart,
        period_end: header.periodEnd,
        statement_date: header.statementDate || header.periodEnd,
        currency: 'CNY',
        opening_balance: null,
        closing_balance: header.cnyBalance,
        total_debit: totalDebit,
        total_credit: totalCredit,
        parser_version: PARSER_VERSION,
        transactions,
        warnings,
        summary: {
            cny_balance: header.cnyBalance,
            usd_balance: header.usdBalance,
        },
    };
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const BCM_PARSER_VERSION = PARSER_VERSION;
