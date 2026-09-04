function normalizeDate(value) {
    if (!value) return null;

    const dateString = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;

    const date = new Date(`${dateString}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) {
        return null;
    }

    return dateString;
}

export function validateInvoiceProjectDate({
    invoiceDate,
    projectStartDate,
    projectEndDate,
}) {
    const invoice = normalizeDate(invoiceDate);
    const start = normalizeDate(projectStartDate);
    const end = normalizeDate(projectEndDate);

    if (!invoice || !start || !end) {
        return { outOfRange: false };
    }

    return {
        outOfRange: invoice < start || invoice > end,
        invoiceDate: invoice,
        projectStartDate: start,
        projectEndDate: end,
    };
}
