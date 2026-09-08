export function needsAmountHkd(amountHkd) {
    if (amountHkd == null || amountHkd === "") return true;
    const value = typeof amountHkd === "number" ? amountHkd : parseFloat(amountHkd);
    return !Number.isFinite(value) || value === 0;
}

export function computeAmountHkd(amount, rate) {
    const parsedAmount = typeof amount === "number" ? amount : parseFloat(String(amount).replace(/,/g, ""));
    const parsedRate = typeof rate === "number" ? rate : parseFloat(rate);
    if (!Number.isFinite(parsedAmount) || !Number.isFinite(parsedRate)) {
        return null;
    }
    return parseFloat((parsedAmount * parsedRate).toFixed(2));
}

export async function lookupRateToHkd(client, currency, invoiceDate) {
    if (!currency || !invoiceDate) return null;
    if (String(currency).toUpperCase() === "HKD") return 1;

    const date = new Date(invoiceDate);
    if (Number.isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const targetDate = year === 2025 ? "2025-01-01" : `${year}-${month}-01`;

    const { data, error } = await client
        .from("currency_rates")
        .select("rate_to_hkd")
        .eq("currency_code", String(currency).toUpperCase())
        .eq("rate_date", targetDate)
        .limit(1)
        .single();

    if (error || !data) return null;
    const rate = parseFloat(data.rate_to_hkd);
    return Number.isFinite(rate) ? rate : null;
}

export async function resolveAmountHkd(client, invoice) {
    if (!invoice || !needsAmountHkd(invoice.amount_hkd)) {
        return null;
    }
    const amount = parseFloat(invoice.amount);
    if (!Number.isFinite(amount) || !invoice.currency) {
        return null;
    }
    const rate = await lookupRateToHkd(client, invoice.currency, invoice.invoice_date);
    if (rate == null) return null;
    return computeAmountHkd(amount, rate);
}
