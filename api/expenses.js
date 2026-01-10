import { supabase } from "./_supabase.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: 'Supabase client not initialized' });
        }

        // Fetch data from Supabase invoices table
        const { data, error } = await supabase
            .from('invoices')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Supabase Error:", error);
            return json(res, 500, { success: false, message: error.message });
        }

        if (!data || data.length === 0) {
            return json(res, 200, { success: true, data: [] });
        }

        // Map Supabase fields to frontend display format
        const result = data.map((item, index) => ({
            // Core fields
            "Invoice Date": item.invoice_date || "",
            "Vender": item.vendor || "",
            "Amount": item.amount != null ? String(item.amount) : "",
            "Currency": item.currency || "",
            "Amount(HKD)": item.amount_hkd != null ? String(item.amount_hkd) : "",
            "Country": item.country || "",
            "Category": item.category || "",
            "Status": item.status || "",
            "Charge to Company": item.charge_to_company || "",
            "Charge to Project": item.charge_to_project || "",
            "Owner": item.owner_name || "",
            "Invoice ID": item.generated_invoice_id || "",
            "Location(City)": item.location_city || "",

            // File fields - for R2 preview
            "file_link": item.file_link || "",
            "Drive_ID": item.file_id || "",
            "file_ID_HASH": item.file_ID_HASH || "",  // R2 file hash for preview

            // Use Supabase id as row identifier
            "_rowNumber": item.id,
            "_supabaseId": item.id
        }));

        return json(res, 200, {
            success: true,
            data: result
        });
    } catch (e) {
        console.error("API Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
