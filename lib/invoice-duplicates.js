function firstPresent(record, keys) {
    for (const key of keys) {
        if (record?.[key] == null) continue;
        const value = record[key];
        if (typeof value === "string" && value.trim() === "") continue;
        return value;
    }
    return "";
}

function recordId(record) {
    const id = Number(record?.id ?? record?._rowNumber ?? record?._supabaseId);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeVendor(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeAmount(value) {
    if (value == null || value === "") return null;
    const amount = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
    if (!Number.isFinite(amount)) return null;
    return amount.toFixed(2);
}

function normalizeCurrency(value) {
    return String(value || "").trim().toUpperCase();
}

function normalizeDate(value) {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    const isoDate = text.match(/\d{4}-\d{2}-\d{2}/);
    return isoDate ? isoDate[0] : "";
}

function normalizeInvoiceNumber(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function duplicateFields(record = {}) {
    return {
        id: recordId(record),
        vendor: firstPresent(record, ["vendor", "Vender", "Vendor"]),
        amount: firstPresent(record, ["amount", "Amount"]),
        currency: firstPresent(record, ["currency", "Currency"]),
        invoice_date: firstPresent(record, ["invoice_date", "Invoice Date"]),
        invoice_number: firstPresent(record, ["invoice_number", "Invoice Number"]),
        status: firstPresent(record, ["status", "Status"]),
        invoice_id: firstPresent(record, ["generated_invoice_id", "Invoice ID"]),
    };
}

export function invoicesAreDuplicates(leftRecord, rightRecord) {
    const left = duplicateFields(leftRecord);
    const right = duplicateFields(rightRecord);
    if (left.id == null || right.id == null || left.id === right.id) {
        return false;
    }

    const vendor = normalizeVendor(left.vendor);
    if (!vendor || vendor !== normalizeVendor(right.vendor)) {
        return false;
    }

    const amount = normalizeAmount(left.amount);
    if (amount == null || amount !== normalizeAmount(right.amount)) {
        return false;
    }

    const currency = normalizeCurrency(left.currency);
    if (!currency || currency !== normalizeCurrency(right.currency)) {
        return false;
    }

    const invoiceDate = normalizeDate(left.invoice_date);
    if (!invoiceDate || invoiceDate !== normalizeDate(right.invoice_date)) {
        return false;
    }

    const leftNumber = normalizeInvoiceNumber(left.invoice_number);
    const rightNumber = normalizeInvoiceNumber(right.invoice_number);
    if (leftNumber && rightNumber && leftNumber !== rightNumber) {
        return false;
    }

    return true;
}

export function annotateDuplicates(records) {
    const list = Array.isArray(records) ? records : [];
    return list.map((record) => {
        const duplicate_matches = list
            .filter((other) => invoicesAreDuplicates(record, other))
            .map((other) => {
                const fields = duplicateFields(other);
                return {
                    id: fields.id,
                    status: fields.status,
                    vendor: fields.vendor,
                    amount: fields.amount == null ? "" : String(fields.amount),
                    currency: fields.currency,
                    invoice_date: fields.invoice_date,
                    invoice_number: fields.invoice_number,
                    invoice_id: fields.invoice_id,
                };
            });
        return { ...record, duplicate_matches };
    });
}

export function isReviewableStatus(status) {
    const normalized = String(status || "").toLowerCase().trim();
    if (!normalized) return false;
    return normalized.includes("waiting") || normalized === "confirmed";
}
