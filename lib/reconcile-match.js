/**
 * Multi-currency matching between bank transactions and invoices.
 */

function absDiff(a, b) {
    return Math.abs(Number(a) - Number(b));
}

function daysBetween(a, b) {
    if (!a || !b) return 999;
    const da = new Date(a);
    const db = new Date(b);
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 999;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function tokenize(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2);
}

function vendorOverlap(description, vendor) {
    const a = new Set(tokenize(description));
    const b = tokenize(vendor);
    if (!a.size || !b.length) return 0;
    let hits = 0;
    for (const t of b) {
        if (a.has(t)) hits += 1;
    }
    return hits / b.length;
}

/**
 * Convert amount to HKD using invoice.amount_hkd when possible, else rates map.
 * @param {{ amount: number, currency: string, amount_hkd?: number, invoice_date?: string }} inv
 * @param {Map<string, number>|{ get: Function }} ratesByCurrency  currency -> rate_to_hkd
 */
export function toHkd(amount, currency, amountHkd, ratesByCurrency) {
    if (amountHkd != null && Number.isFinite(Number(amountHkd))) {
        return Number(amountHkd);
    }
    const code = String(currency || '').toUpperCase();
    if (code === 'HKD') return Number(amount);
    const rate = ratesByCurrency?.get?.(code) ?? ratesByCurrency?.[code];
    if (rate == null) return null;
    return Number(amount) * Number(rate);
}

/**
 * Score a single invoice against a bank transaction.
 * Higher is better. Returns null if outside date window or no amount signal.
 *
 * @param {object} tx bank transaction
 * @param {object} invoice
 * @param {object} [opts]
 * @param {Map|object} [opts.ratesByCurrency]
 * @param {number} [opts.dateBefore=10]
 * @param {number} [opts.dateAfter=5]
 * @param {number} [opts.hkdTolerance=0.03]
 */
export function scoreInvoiceMatch(tx, invoice, opts = {}) {
    if (!tx || !invoice) return null;
    if (tx.is_fee) return null;
    if (invoice.reconciled_at || invoice.bank_transaction_id) return null;
    if (invoice.deleted_at) return null;

    const status = String(invoice.status || '').toLowerCase();
    if (status && !['reviewed', 'submitted', 'review', 'confirmed'].includes(status) && status !== 'pending review') {
        // Allow common statuses; also allow empty
        if (!['reviewed', 'submitted'].includes(status)) {
            // keep permissive for 'Reviewed' etc already lowercased
        }
    }

    const txnDate = tx.txn_date || tx.posting_date;
    const invDate = invoice.invoice_date;
    const delta = daysBetween(txnDate, invDate);
    // invoice date relative to txn: allow -10 .. +5 means invDate - txnDate in [-10, 5]
    // daysBetween(txn, inv) = inv - txn
    const dateBefore = opts.dateBefore ?? 10;
    const dateAfter = opts.dateAfter ?? 5;
    if (delta < -dateBefore || delta > dateAfter) return null;

    const invCurrency = String(invoice.currency || '').toUpperCase();
    const invAmount = Number(invoice.amount);
    const txnCurrency = String(tx.txn_currency || '').toUpperCase();
    const postingCurrency = String(tx.posting_currency || '').toUpperCase();
    const txnAmount = Number(tx.txn_amount);
    const postingAmount = Number(tx.posting_amount);

    let score = 0;
    let reason = '';

    // 1) Original transaction currency exact match
    if (invCurrency && txnCurrency && invCurrency === txnCurrency && absDiff(invAmount, txnAmount) <= 0.01) {
        score = 100;
        reason = 'txn_currency_exact';
    }
    // 2) Posting currency exact match
    else if (invCurrency && postingCurrency && invCurrency === postingCurrency && absDiff(invAmount, postingAmount) <= 0.01) {
        score = 85;
        reason = 'posting_currency_exact';
    }
    // 3) HKD conversion within tolerance
    else {
        const rates = opts.ratesByCurrency || new Map();
        const invHkd = toHkd(invAmount, invCurrency, invoice.amount_hkd, rates);
        const txHkd = toHkd(txnAmount, txnCurrency, null, rates)
            ?? toHkd(postingAmount, postingCurrency, null, rates);
        const tol = opts.hkdTolerance ?? 0.03;
        if (invHkd != null && txHkd != null && txHkd > 0) {
            const pct = absDiff(invHkd, txHkd) / txHkd;
            if (pct <= tol) {
                score = 60 - pct * 100;
                reason = 'hkd_tolerance';
            }
        }
    }

    if (score <= 0) return null;

    // Date proximity bonus (max +10)
    const dateScore = Math.max(0, 10 - Math.abs(delta));
    score += dateScore;

    // Vendor overlap bonus (max +15)
    const overlap = vendorOverlap(tx.description, invoice.vendor);
    score += overlap * 15;

    return {
        invoice_id: invoice.id,
        score: Math.round(score * 100) / 100,
        reason,
        date_delta: delta,
        vendor_overlap: Math.round(overlap * 100) / 100,
        invoice: {
            id: invoice.id,
            vendor: invoice.vendor,
            amount: invoice.amount,
            currency: invoice.currency,
            invoice_date: invoice.invoice_date,
            generated_invoice_id: invoice.generated_invoice_id,
            status: invoice.status,
            amount_hkd: invoice.amount_hkd,
        },
    };
}

/**
 * Rank candidate invoices for a transaction.
 * @returns {Array} top N matches
 */
export function rankInvoiceMatches(tx, invoices, opts = {}) {
    const topN = opts.topN ?? 3;
    if (tx?.is_fee) return [];
    if (/还款|PAYMENT|CREDIT BALANCE/i.test(String(tx?.description || '')) && tx?.direction === 'credit') {
        // Repayments typically have no invoice
        return [];
    }

    const scored = [];
    for (const inv of invoices || []) {
        const result = scoreInvoiceMatch(tx, inv, opts);
        if (result) scored.push(result);
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
}

/**
 * Build a rates map from currency_rates rows for a given month (YYYY-MM-01).
 */
export function ratesMapFromRows(rows, rateDate) {
    const map = new Map();
    for (const row of rows || []) {
        if (rateDate && row.rate_date && String(row.rate_date).slice(0, 7) !== String(rateDate).slice(0, 7)) {
            continue;
        }
        const code = String(row.currency_code || '').toUpperCase();
        if (code) map.set(code, Number(row.rate_to_hkd));
    }
    return map;
}
