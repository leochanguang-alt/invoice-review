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
        .sort((a, b) => {
            const left = a.invoice_date || "9999-12-31";
            const right = b.invoice_date || "9999-12-31";
            return left.localeCompare(right) || Number(a.id) - Number(b.id);
        })
        .map((invoice, index) => {
            const sequence = index + 1;
            const generatedInvoiceId = formatInvoiceId({
                projectCode,
                sequence,
                amount: invoice.amount,
                currency: invoice.currency,
            });
            const extension = String(invoice.achieved_file_id).match(/\.[^.]+$/)?.[0] || ".pdf";
            return {
                invoiceId: invoice.id,
                sequence,
                oldKey: invoice.achieved_file_id,
                generatedInvoiceId,
                newKey: `bui_invoice/projects/${projectCode}/${generatedInvoiceId}${extension}`,
            };
        });
}
