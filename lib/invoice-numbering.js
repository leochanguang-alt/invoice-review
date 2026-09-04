function isMissingInvoiceDate(value) {
    return value == null || value === "";
}

function compareInvoiceDates(a, b) {
    const leftMissing = isMissingInvoiceDate(a.invoice_date);
    const rightMissing = isMissingInvoiceDate(b.invoice_date);
    if (leftMissing && rightMissing) {
        return Number(a.id) - Number(b.id);
    }
    if (leftMissing) {
        return 1;
    }
    if (rightMissing) {
        return -1;
    }
    return String(a.invoice_date).localeCompare(String(b.invoice_date))
        || Number(a.id) - Number(b.id);
}

function extensionFromOldKey(oldKey) {
    const basename = String(oldKey).split("/").pop() || "";
    const match = basename.match(/\.([^.]+)$/);
    return match ? `.${match[1]}` : ".pdf";
}

export function formatInvoiceId({ projectCode, sequence, amount, currency }) {
    const rounded = Math.round(Number(String(amount).replaceAll(",", "")) || 0);
    const amountPart = rounded < 0 ? `m${Math.abs(rounded)}` : String(rounded);
    return `${projectCode}-${String(sequence).padStart(4, "0")}-${amountPart}${String(currency || "").trim().toUpperCase()}`;
}

export function parseProjectSequence(invoiceId, projectCode) {
    const prefix = `${projectCode}-`;
    if (!String(invoiceId || "").startsWith(prefix)) return null;
    const value = Number.parseInt(String(invoiceId).slice(prefix.length).split("-")[0], 10);
    return Number.isInteger(value) && value > 0 ? value : null;
}

export function buildRenumberManifest(invoices, projectCode) {
    return [...invoices]
        .sort(compareInvoiceDates)
        .map((invoice, index) => {
            const sequence = index + 1;
            const generatedInvoiceId = formatInvoiceId({
                projectCode,
                sequence,
                amount: invoice.amount,
                currency: invoice.currency,
            });
            const extension = extensionFromOldKey(invoice.achieved_file_id);
            return {
                invoiceId: invoice.id,
                sequence,
                oldKey: invoice.achieved_file_id,
                generatedInvoiceId,
                newKey: `bui_invoice/projects/${projectCode}/${generatedInvoiceId}${extension}`,
            };
        });
}
