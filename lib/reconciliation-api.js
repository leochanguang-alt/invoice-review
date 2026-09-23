import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { supabase } from './_supabase.js';
import { parseStatementPdf } from './statement-parsers/index.js';
import { rankInvoiceMatches, ratesMapFromRows } from './reconcile-match.js';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const r2 = (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
    ? new S3Client({
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
    })
    : null;

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function decodeBase64Pdf(base64) {
    const cleaned = String(base64 || '').replace(/^data:application\/pdf;base64,/, '');
    return Buffer.from(cleaned, 'base64');
}

async function findDuplicate(fileHash, bank, cardLast4, periodStart, periodEnd) {
    const { data: byHash } = await supabase
        .from('bank_statements')
        .select('id, bank, card_last4, period_start, period_end, original_filename')
        .eq('file_hash', fileHash)
        .is('deleted_at', null)
        .maybeSingle();
    if (byHash) return { reason: 'file_hash', statement: byHash };

    if (bank && cardLast4 && periodStart && periodEnd) {
        const { data: byPeriod } = await supabase
            .from('bank_statements')
            .select('id, bank, card_last4, period_start, period_end, original_filename')
            .eq('bank', bank)
            .eq('card_last4', cardLast4)
            .eq('period_start', periodStart)
            .eq('period_end', periodEnd)
            .is('deleted_at', null)
            .maybeSingle();
        if (byPeriod) return { reason: 'bank_period', statement: byPeriod };
    }
    return null;
}

/**
 * Handle reconciliation actions. Mounted under manage.js to stay within Vercel Hobby function limits.
 * @returns {Promise<boolean>} true if the action was handled
 */
export async function handleReconciliationAction(req, res, body, json) {
    const action = body?.action || req.query?.action;
    if (!action || !String(action).startsWith('recon_')) return false;

    if (!supabase) {
        json(res, 500, { success: false, message: 'Supabase client not initialized' });
        return true;
    }

    try {
        if (action === 'recon_upload') {
            await handleUpload(body, json, res);
            return true;
        }
        if (action === 'recon_confirm') {
            await handleConfirm(body, json, res);
            return true;
        }
        if (action === 'recon_statements') {
            await handleStatements(json, res);
            return true;
        }
        if (action === 'recon_transactions') {
            await handleTransactions(req, body, json, res);
            return true;
        }
        if (action === 'recon_match') {
            await handleMatch(body, json, res);
            return true;
        }
        if (action === 'recon_unmatch') {
            await handleUnmatch(body, json, res);
            return true;
        }
        if (action === 'recon_delete_statement') {
            await handleDeleteStatement(body, json, res);
            return true;
        }

        json(res, 400, { success: false, message: `Unknown reconciliation action: ${action}` });
        return true;
    } catch (err) {
        console.error('[RECON]', err);
        json(res, 500, { success: false, message: err.message || 'Reconciliation error' });
        return true;
    }
}

async function handleUpload(body, json, res) {
    const { file_base64, filename } = body;
    if (!file_base64) {
        return json(res, 400, { success: false, message: 'Missing file_base64' });
    }

    const buf = decodeBase64Pdf(file_base64);
    if (!buf.length) {
        return json(res, 400, { success: false, message: 'Empty PDF' });
    }
    if (buf.length > MAX_UPLOAD_BYTES) {
        return json(res, 400, { success: false, message: `PDF too large (max ${MAX_UPLOAD_BYTES} bytes)` });
    }

    const fileHash = sha256(buf);
    const hashDup = await findDuplicate(fileHash);
    if (hashDup) {
        return json(res, 409, {
            success: false,
            duplicate: true,
            reason: hashDup.reason,
            message: 'This file was already uploaded',
            existing: hashDup.statement,
        });
    }

    const parsed = await parseStatementPdf(buf);
    if (!parsed.ok) {
        return json(res, 400, { success: false, message: parsed.error, bank: parsed.bank });
    }

    const periodDup = await findDuplicate(
        fileHash,
        parsed.bank,
        parsed.card_last4,
        parsed.period_start,
        parsed.period_end,
    );
    if (periodDup) {
        return json(res, 409, {
            success: false,
            duplicate: true,
            reason: periodDup.reason,
            message: `Statement already exists for ${parsed.bank} ****${parsed.card_last4} ${parsed.period_start}–${parsed.period_end}`,
            existing: periodDup.statement,
            preview: summarizePreview(parsed, filename, fileHash),
        });
    }

    return json(res, 200, {
        success: true,
        preview: summarizePreview(parsed, filename, fileHash),
        file_base64, // echoed so confirm can re-use without re-upload; client may omit and resend
    });
}

function summarizePreview(parsed, filename, fileHash) {
    return {
        bank: parsed.bank,
        account_label: parsed.account_label,
        card_last4: parsed.card_last4,
        period_start: parsed.period_start,
        period_end: parsed.period_end,
        statement_date: parsed.statement_date,
        currency: parsed.currency,
        opening_balance: parsed.opening_balance,
        closing_balance: parsed.closing_balance,
        total_debit: parsed.total_debit,
        total_credit: parsed.total_credit,
        tx_count: parsed.tx_count ?? parsed.transactions.length,
        parser_version: parsed.parser_version,
        warnings: parsed.warnings || [],
        transactions: parsed.transactions,
        original_filename: filename || null,
        file_hash: fileHash,
        summary: parsed.summary || null,
    };
}

async function handleConfirm(body, json, res) {
    const { file_base64, filename, preview } = body;
    if (!file_base64) {
        return json(res, 400, { success: false, message: 'Missing file_base64' });
    }

    const buf = decodeBase64Pdf(file_base64);
    if (buf.length > MAX_UPLOAD_BYTES) {
        return json(res, 400, { success: false, message: 'PDF too large' });
    }

    const fileHash = sha256(buf);
    // Re-parse for safety (do not trust client preview for transaction rows)
    const parsed = await parseStatementPdf(buf);
    if (!parsed.ok) {
        return json(res, 400, { success: false, message: parsed.error });
    }

    const dup = await findDuplicate(
        fileHash,
        parsed.bank,
        parsed.card_last4,
        parsed.period_start,
        parsed.period_end,
    );
    if (dup) {
        return json(res, 409, {
            success: false,
            duplicate: true,
            reason: dup.reason,
            message: 'Statement already imported',
            existing: dup.statement,
        });
    }

    if (!r2 || !BUCKET_NAME) {
        return json(res, 500, { success: false, message: 'R2 client not configured' });
    }

    const periodTag = `${parsed.period_start || 'na'}_${parsed.period_end || 'na'}`.replace(/-/g, '');
    const r2Key = `bui_invoice/bank_statements/${parsed.bank}/${periodTag}_${fileHash.slice(0, 8)}.pdf`;

    await r2.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: r2Key,
        Body: buf,
        ContentType: 'application/pdf',
    }));

    const statementRow = {
        bank: parsed.bank,
        account_label: parsed.account_label,
        card_last4: parsed.card_last4,
        period_start: parsed.period_start,
        period_end: parsed.period_end,
        statement_date: parsed.statement_date,
        currency: parsed.currency,
        opening_balance: parsed.opening_balance,
        closing_balance: parsed.closing_balance,
        total_debit: parsed.total_debit,
        total_credit: parsed.total_credit,
        file_hash: fileHash,
        r2_key: r2Key,
        original_filename: filename || preview?.original_filename || null,
        parser_version: parsed.parser_version,
        tx_count: parsed.transactions.length,
        status: 'confirmed',
    };

    const { data: inserted, error: insertErr } = await supabase
        .from('bank_statements')
        .insert(statementRow)
        .select('*')
        .single();

    if (insertErr) {
        console.error('[RECON] insert statement', insertErr);
        return json(res, 500, { success: false, message: insertErr.message });
    }

    const txRows = parsed.transactions.map((t) => ({
        statement_id: inserted.id,
        seq: t.seq,
        txn_date: t.txn_date,
        posting_date: t.posting_date,
        card_last4: t.card_last4,
        description: t.description,
        direction: t.direction,
        txn_currency: t.txn_currency,
        txn_amount: t.txn_amount,
        posting_currency: t.posting_currency,
        posting_amount: t.posting_amount,
        fx_rate: t.fx_rate,
        is_fee: !!t.is_fee,
        ignored: false,
        raw_text: t.raw_text,
    }));

    if (txRows.length) {
        const { error: txErr } = await supabase.from('bank_transactions').insert(txRows);
        if (txErr) {
            console.error('[RECON] insert transactions', txErr);
            await supabase.from('bank_statements').update({ deleted_at: new Date().toISOString() }).eq('id', inserted.id);
            return json(res, 500, { success: false, message: txErr.message });
        }
    }

    return json(res, 200, { success: true, statement: inserted });
}

async function handleStatements(json, res) {
    const { data: statements, error } = await supabase
        .from('bank_statements')
        .select('*')
        .is('deleted_at', null)
        .order('period_end', { ascending: false });

    if (error) return json(res, 500, { success: false, message: error.message });

    const ids = (statements || []).map((s) => s.id);
    let matchedByStatement = {};
    if (ids.length) {
        const { data: matchedRows } = await supabase
            .from('bank_transactions')
            .select('statement_id, matched_invoice_id')
            .in('statement_id', ids)
            .not('matched_invoice_id', 'is', null);

        for (const row of matchedRows || []) {
            matchedByStatement[row.statement_id] = (matchedByStatement[row.statement_id] || 0) + 1;
        }
    }

    const result = (statements || []).map((s) => ({
        ...s,
        matched_count: matchedByStatement[s.id] || 0,
    }));

    return json(res, 200, { success: true, data: result });
}

async function handleTransactions(req, body, json, res) {
    const statementId = body.statement_id || req.query?.statement_id;
    const status = body.status || req.query?.status || 'all'; // all | unmatched | matched

    if (!statementId) {
        return json(res, 400, { success: false, message: 'Missing statement_id' });
    }

    let query = supabase
        .from('bank_transactions')
        .select('*, invoices:matched_invoice_id(id, vendor, amount, currency, invoice_date, generated_invoice_id, status, amount_hkd, file_link_r2, file_link, achieved_file_link)')
        .eq('statement_id', statementId)
        .order('seq', { ascending: true });

    if (status === 'unmatched') {
        query = query.is('matched_invoice_id', null).eq('ignored', false);
    } else if (status === 'matched') {
        query = query.not('matched_invoice_id', 'is', null);
    }

    const { data: txs, error } = await query;
    if (error) return json(res, 500, { success: false, message: error.message });

    // Load candidate invoices for unmatched rows
    const unmatched = (txs || []).filter((t) => !t.matched_invoice_id && !t.is_fee && !t.ignored);
    let candidates = [];
    let ratesByCurrency = new Map();

    if (unmatched.length) {
        const dates = unmatched.map((t) => t.txn_date || t.posting_date).filter(Boolean).sort();
        const minDate = dates[0];
        const maxDate = dates[dates.length - 1];

        // Expand window by matching tolerances
        const { data: invoices } = await supabase
            .from('invoices')
            .select('id, vendor, amount, currency, invoice_date, generated_invoice_id, status, amount_hkd, reconciled_at, bank_transaction_id, deleted_at, file_link_r2, file_link, achieved_file_link')
            .is('deleted_at', null)
            .is('reconciled_at', null)
            .is('bank_transaction_id', null)
            .gte('invoice_date', addDays(minDate, -1))
            .lte('invoice_date', addDays(maxDate, 1));

        candidates = (invoices || []).filter((inv) => {
            const st = String(inv.status || '').toLowerCase();
            // Production statuses: "Submitted", "Waiting for Confirm"
            return !st
                || st === 'submitted'
                || st === 'reviewed'
                || st === 'confirmed'
                || st.includes('waiting')
                || st.includes('confirm');
        });

        const monthKeys = new Set(
            unmatched.map((t) => String(t.txn_date || t.posting_date || '').slice(0, 7) + '-01').filter((d) => d.length === 10),
        );
        if (monthKeys.size) {
            const { data: rateRows } = await supabase
                .from('currency_rates')
                .select('currency_code, rate_date, rate_to_hkd')
                .in('rate_date', [...monthKeys]);
            // Prefer most recent month's rates for each currency (simple: last write wins)
            ratesByCurrency = ratesMapFromRows(rateRows || []);
        }
    }

    const data = (txs || []).map((tx) => {
        const matchedInvoice = tx.invoices || null;
        delete tx.invoices;
        const suggestions = (!tx.matched_invoice_id && !tx.is_fee && !tx.ignored)
            ? rankInvoiceMatches(tx, candidates, { ratesByCurrency, topN: 3 })
            : [];
        return {
            ...tx,
            matched_invoice: matchedInvoice,
            suggestions,
        };
    });

    return json(res, 200, { success: true, data });
}

function addDays(isoDate, days) {
    if (!isoDate) return isoDate;
    const d = new Date(isoDate);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

async function handleMatch(body, json, res) {
    const { transaction_id, invoice_id, matched_by } = body;
    if (!transaction_id || !invoice_id) {
        return json(res, 400, { success: false, message: 'Missing transaction_id or invoice_id' });
    }

    const { data: tx, error: txErr } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('id', transaction_id)
        .single();
    if (txErr || !tx) return json(res, 404, { success: false, message: 'Transaction not found' });
    if (tx.matched_invoice_id) {
        return json(res, 409, { success: false, message: 'Transaction already matched' });
    }

    const { data: inv, error: invErr } = await supabase
        .from('invoices')
        .select('id, reconciled_at, bank_transaction_id, deleted_at')
        .eq('id', invoice_id)
        .single();
    if (invErr || !inv || inv.deleted_at) {
        return json(res, 404, { success: false, message: 'Invoice not found' });
    }
    if (inv.bank_transaction_id || inv.reconciled_at) {
        return json(res, 409, { success: false, message: 'Invoice already reconciled with another transaction' });
    }

    const now = new Date().toISOString();

    const { error: u1 } = await supabase
        .from('bank_transactions')
        .update({
            matched_invoice_id: invoice_id,
            matched_at: now,
            matched_by: matched_by || null,
        })
        .eq('id', transaction_id)
        .is('matched_invoice_id', null);

    if (u1) return json(res, 500, { success: false, message: u1.message });

    const { error: u2 } = await supabase
        .from('invoices')
        .update({
            bank_transaction_id: transaction_id,
            reconciled_at: now,
        })
        .eq('id', invoice_id)
        .is('bank_transaction_id', null);

    if (u2) {
        // rollback tx side
        await supabase
            .from('bank_transactions')
            .update({ matched_invoice_id: null, matched_at: null, matched_by: null })
            .eq('id', transaction_id);
        if (/unique|duplicate/i.test(u2.message)) {
            return json(res, 409, { success: false, message: 'Invoice already reconciled' });
        }
        return json(res, 500, { success: false, message: u2.message });
    }

    const { data: invoice } = await supabase
        .from('invoices')
        .select('id, vendor, amount, currency, invoice_date, generated_invoice_id, status, amount_hkd, file_link_r2, file_link, achieved_file_link')
        .eq('id', invoice_id)
        .single();

    return json(res, 200, {
        success: true,
        transaction_id,
        invoice_id,
        matched_at: now,
        matched_invoice: invoice,
    });
}

async function handleUnmatch(body, json, res) {
    const { transaction_id } = body;
    if (!transaction_id) {
        return json(res, 400, { success: false, message: 'Missing transaction_id' });
    }

    const { data: tx, error: txErr } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('id', transaction_id)
        .single();
    if (txErr || !tx) return json(res, 404, { success: false, message: 'Transaction not found' });

    // Already matched → clear the invoice link
    if (tx.matched_invoice_id) {
        const invoiceId = tx.matched_invoice_id;

        const { error: u1 } = await supabase
            .from('bank_transactions')
            .update({ matched_invoice_id: null, matched_at: null, matched_by: null })
            .eq('id', transaction_id);
        if (u1) return json(res, 500, { success: false, message: u1.message });

        const { error: u2 } = await supabase
            .from('invoices')
            .update({ bank_transaction_id: null, reconciled_at: null })
            .eq('id', invoiceId)
            .eq('bank_transaction_id', transaction_id);
        if (u2) return json(res, 500, { success: false, message: u2.message });

        return json(res, 200, {
            success: true,
            transaction_id,
            invoice_id: invoiceId,
            mode: 'unlinked',
        });
    }

    // Not matched → abandon matching (ignore this transaction)
    if (tx.ignored) {
        return json(res, 200, { success: true, transaction_id, mode: 'ignored', already: true });
    }

    const { error } = await supabase
        .from('bank_transactions')
        .update({ ignored: true })
        .eq('id', transaction_id);
    if (error) return json(res, 500, { success: false, message: error.message });

    return json(res, 200, { success: true, transaction_id, mode: 'ignored' });
}

async function handleDeleteStatement(body, json, res) {
    const { statement_id } = body;
    if (!statement_id) {
        return json(res, 400, { success: false, message: 'Missing statement_id' });
    }

    const { count, error: countErr } = await supabase
        .from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('statement_id', statement_id)
        .not('matched_invoice_id', 'is', null);

    if (countErr) return json(res, 500, { success: false, message: countErr.message });
    if (count > 0) {
        return json(res, 400, {
            success: false,
            message: `Cannot delete: ${count} matched transaction(s). Unmatch them first.`,
        });
    }

    const { error } = await supabase
        .from('bank_statements')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', statement_id);

    if (error) return json(res, 500, { success: false, message: error.message });
    return json(res, 200, { success: true });
}
