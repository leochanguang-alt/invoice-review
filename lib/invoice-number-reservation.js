export async function reserveInvoiceNumber(supabase, {
    invoiceId,
    projectCode,
    amount,
    currency,
}) {
    const normalizedInvoiceId = Number(invoiceId);
    if (!Number.isSafeInteger(normalizedInvoiceId) || normalizedInvoiceId <= 0) {
        throw new Error("invoiceId must be a safe positive integer");
    }
    const { data, error } = await supabase.rpc("reserve_invoice_number", {
        p_invoice_id: normalizedInvoiceId,
        p_project_code: projectCode,
        p_amount: Number(String(amount).replaceAll(",", "")) || 0,
        p_currency: String(currency || "").trim().toUpperCase(),
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") {
        throw new Error("empty reservation response from reserve_invoice_number");
    }
    return {
        projectSequence: row.project_sequence,
        generatedInvoiceId: row.generated_invoice_id,
    };
}
