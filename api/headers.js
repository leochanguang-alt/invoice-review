import { supabase } from "./_supabase.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
        }

        // Read one row to infer headers
        const { data, error } = await supabase
            .from('invoices')
            .select('*')
            .limit(1);

        if (error) {
            console.error("Supabase Error:", error.message);
            return json(res, 500, { success: false, message: error.message });
        }

        const headers = data && data.length > 0 ? Object.keys(data[0]) : [];

        return json(res, 200, { success: true, headers });
    } catch (e) {
        console.error("API Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
