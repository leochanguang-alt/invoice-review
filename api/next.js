import { supabase } from "./_supabase.js";

const WAITING_STATUS = (process.env.WAITING_STATUS || "Waiting for Confirm").trim();

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

    // First waiting record by created_at asc
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('status', WAITING_STATUS)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      return json(res, 500, { success: false, message: error.message });
    }

    if (!data || data.length === 0) {
      return json(res, 200, { success: true, data: null });
    }

    const rec = data[0];
    const mapped = {
      rowNumber: rec.id,
      ID: rec.id,
      Invoice_data: rec.invoice_date || "",
      Vendor: rec.vendor || "",
      amount: rec.amount ?? "",
      currency: rec.currency || "",
      "Location(City)": rec.location_city || "",
      Country: rec.country || "",
      Category: rec.category || "",
      Status: rec.status || "",
      "Charge to Company": rec.charge_to_company || "",
      "Charge to Project": rec.charge_to_project || "",
      "Final Link": rec.file_link_r2 || rec.file_link || rec.archived_file_link || ""
    };

    return json(res, 200, { success: true, data: mapped });
  } catch (e) {
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
