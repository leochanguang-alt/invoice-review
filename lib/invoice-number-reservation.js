export async function reserveInvoiceNumber(supabase, {
    invoiceId,
    projectCode,
    amount,
    currency,
}) {
    const { data, error } = await supabase.rpc("reserve_invoice_number", {
        p_invoice_id: invoiceId,
        p_project_code: projectCode,
        p_amount: Number(String(amount).replaceAll(",", "")) || 0,
        p_currency: String(currency || "").trim().toUpperCase(),
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : data;
    return {
        projectSequence: row.project_sequence,
        generatedInvoiceId: row.generated_invoice_id,
    };
}
