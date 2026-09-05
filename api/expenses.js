import { supabase } from "../lib/_supabase.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export async function fetchAllExpenses(client, {
    statusFilter = null,
    pageSize = 1000,
    maxPages = 10000,
} = {}) {
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
        throw new Error("pageSize must be a positive integer");
    }
    if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
        throw new Error("maxPages must be a positive integer");
    }
    const rows = [];
    let lastId = null;
    for (let page = 0; page < maxPages; page += 1) {
        let query = client
            .from("invoices")
            .select("*")
            .is("deleted_at", null)
            .order("id", { ascending: false });
        if (statusFilter) {
            query = query.ilike("status", statusFilter);
        }
        if (lastId !== null) {
            query = query.lt("id", lastId);
        }
        const { data, error } = await query.limit(pageSize);
        if (error) {
            throw new Error(`Supabase invoice keyset page ${page + 1} failed: ${error.message}`);
        }
        if (!Array.isArray(data)) {
            throw new Error(`Supabase invoice keyset page ${page + 1} returned invalid data`);
        }
        let previousId = lastId;
        for (const row of data) {
            const id = Number(row?.id);
            if (!Number.isSafeInteger(id) || id <= 0) {
                throw new Error(`Supabase invoice keyset page ${page + 1} returned an invalid id`);
            }
            if (previousId !== null && id >= previousId) {
                throw new Error("Supabase invoice keyset cursor did not decrease");
            }
            previousId = id;
        }
        rows.push(...data);
        if (data.length < pageSize) return rows;
        lastId = previousId;
    }
    throw new Error(`Supabase invoice pagination exceeded maximum page limit ${maxPages}`);
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: 'Supabase client not initialized' });
        }

        // Check if we want only submitted records (for summary page)
        const url = new URL(req.url, `http://${req.headers.host}`);
        const statusFilter = url.searchParams.get('status');

        const data = await fetchAllExpenses(supabase, { statusFilter });

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
            "generated_invoice_id": item.generated_invoice_id || "",
            "achieved_file_id": item.achieved_file_id || "",
            "achieved_file_link": item.achieved_file_link || "",
            "Location(City)": item.location_city || "",
            "Remarks": item.remarks || "",

            // File fields - for R2 preview
            "file_link_r2": item.file_link_r2 || "",
            "file_link": item.file_link || "",
            "file_id": item.file_id || "",
            "Drive_ID": item.file_id || "",
            "file_ID_HASH": item.file_ID_HASH || "",
            "file_ID_HASH_R2": item.file_ID_HASH_R2 || "",

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
