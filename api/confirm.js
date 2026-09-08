import { supabase } from "../lib/_supabase.js";
import { resolveAmountHkd } from "../lib/currency-hkd.js";
import {
  applyInvoiceSequenceInvariant,
  invoiceUpdateRequiresReset,
} from "../lib/invoice-update-invariants.js";

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
    const hasProjectInput = Object.prototype.hasOwnProperty.call(body, 'chargeToProject');
    if (hasProjectInput && !String(chargeToProject ?? '').trim()) {
      return json(res, 400, {
        success: false,
        message: "Charge to project cannot be empty",
      });
    }

    // Fetch the invoice record to auto-calculate amount_hkd if missing.
    // We also need deleted_at so we can refuse to confirm a soft-deleted row.
    const { data: invoice, error: fetchErr } = await supabase
      .from('invoices')
      .select(
        'amount, currency, invoice_date, amount_hkd, charge_to_project, project_sequence, generated_invoice_id, achieved_file_id, achieved_file_link, deleted_at',
      )
      .eq('id', recordId)
      .single();

    if (fetchErr) {
      console.error("[CONFIRM] Fetch error:", fetchErr);
      return json(res, 404, { success: false, message: "Record not found" });
    }

    if (invoice?.deleted_at) {
      return json(res, 409, {
        success: false,
        message: "Record is deleted; cannot confirm.",
      });
    }

    // Build update object
    let updates = {
      status: CONFIRMED_STATUS,
      updated_at: new Date().toISOString()
    };

    if (chargeToCompany) {
      updates.charge_to_company = chargeToCompany;
    }
    let projectResetRequired = false;
    if (hasProjectInput) {
      updates.charge_to_project = chargeToProject;
      projectResetRequired = invoiceUpdateRequiresReset(updates, invoice);
      updates = applyInvoiceSequenceInvariant(updates, invoice);
    }

    const amountHkd = await resolveAmountHkd(supabase, invoice);
    if (amountHkd != null) {
      updates.amount_hkd = amountHkd;
      console.log(`[CONFIRM] Auto-calculated amount_hkd: ${invoice.amount} ${invoice.currency} = ${amountHkd} HKD`);
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

    if (projectResetRequired && updates.status === 'Waiting for Confirm') {
      return json(res, 409, {
        success: false,
        message: "Project changed; invoice number and archive were cleared. Please confirm again.",
        status: updates.status,
      });
    }

    console.log(`[CONFIRM] Record ${recordId} confirmed successfully`);
    return json(res, 200, { success: true });

  } catch (e) {
    console.error("[CONFIRM] Error:", e);
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
