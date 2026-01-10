import { supabase } from "./_supabase.js";

const CONFIRMED_STATUS = process.env.CONFIRMED_STATUS || "Confirmed";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { success: false, message: "POST only" });
    }

    if (!supabase) {
      return json(res, 500, { success: false, message: "Supabase client not initialized" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const recordId = Number(body.rowNumber); // rowNumber is actually the Supabase id now
    const chargeToCompany = body.chargeToCompany;
    const chargeToProject = body.chargeToProject;

    if (!recordId) {
      return json(res, 400, { success: false, message: "Missing record ID" });
    }

    // Build update object
    const updates = {
      status: CONFIRMED_STATUS,
      updated_at: new Date().toISOString()
    };

    if (chargeToCompany) {
      updates.charge_to_company = chargeToCompany;
    }
    if (chargeToProject) {
      updates.charge_to_project = chargeToProject;
    }

    // Update Supabase record
    const { error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', recordId);

    if (error) {
      console.error("[CONFIRM] Supabase error:", error);
      return json(res, 500, { success: false, message: error.message });
    }

    console.log(`[CONFIRM] Record ${recordId} confirmed successfully`);
    return json(res, 200, { success: true });

  } catch (e) {
    console.error("[CONFIRM] Error:", e);
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
