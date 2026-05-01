import { supabase } from "../lib/_supabase.js";

const CONFIRMED_STATUS = process.env.CONFIRMED_STATUS || "Confirmed";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// Look up the exchange rate for a currency on the 1st of the invoice's month
async function lookupRate(currency, invoiceDate) {
  if (!currency || !invoiceDate) return null;
  if (currency.toUpperCase() === 'HKD') return 1;

  const date = new Date(invoiceDate);
  if (isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  // For 2025 invoices use 2025-01-01; for later years use 1st of that month
  const targetDate = year === 2025 ? '2025-01-01' : `${year}-${month}-01`;

  const { data, error } = await supabase
    .from('currency_rates')
    .select('rate_to_hkd')
    .eq('currency_code', currency.toUpperCase())
    .eq('rate_date', targetDate)
    .limit(1)
    .single();

  if (error || !data) return null;
  return parseFloat(data.rate_to_hkd);
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

    // Fetch the invoice record to auto-calculate amount_hkd if missing
    const { data: invoice, error: fetchErr } = await supabase
      .from('invoices')
      .select('amount, currency, invoice_date, amount_hkd')
      .eq('id', recordId)
      .single();

    if (fetchErr) {
      console.error("[CONFIRM] Fetch error:", fetchErr);
      return json(res, 404, { success: false, message: "Record not found" });
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

    // Auto-calculate amount_hkd if it's missing
    if (invoice && (invoice.amount_hkd == null || invoice.amount_hkd === 0)) {
      const amount = parseFloat(invoice.amount);
      if (!isNaN(amount) && invoice.currency) {
        const rate = await lookupRate(invoice.currency, invoice.invoice_date);
        if (rate !== null) {
          updates.amount_hkd = parseFloat((amount * rate).toFixed(2));
          console.log(`[CONFIRM] Auto-calculated amount_hkd: ${amount} ${invoice.currency} * ${rate} = ${updates.amount_hkd} HKD`);
        } else {
          console.warn(`[CONFIRM] No exchange rate found for ${invoice.currency} on invoice date ${invoice.invoice_date}`);
        }
      }
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
