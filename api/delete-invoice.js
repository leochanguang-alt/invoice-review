import { supabase } from "../lib/_supabase.js";
import { cleanupAttachments, resolveCleanupStatus } from "../lib/_attachment-cleanup.js";

const DEFAULT_MAX_ATTEMPTS = Number(process.env.CLEANUP_MAX_ATTEMPTS || 5);
const DEFAULT_BATCH_SIZE = Number(process.env.CLEANUP_BATCH_SIZE || 10);

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

async function fetchCleanupCandidates({ id, batchSize, maxAttempts }) {
    let query = supabase
        .from("invoices")
        .select("*")
        .not("deleted_at", "is", null)
        .in("attachment_cleanup_status", ["pending", "failed"])
        .lt("attachment_cleanup_attempts", maxAttempts)
        .order("attachment_cleanup_last_attempt_at", { ascending: true, nullsFirst: true })
        .limit(batchSize);

    if (id != null) {
        query = query.eq("id", id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function processCleanupRecord(record) {
    const previousAttempts = Number(record.attachment_cleanup_attempts) || 0;
    const cleanup = await cleanupAttachments(record);
    const finalStatus = resolveCleanupStatus(cleanup);

    const { error: updateErr } = await supabase
        .from("invoices")
        .update({
            attachment_cleanup_status: finalStatus,
            attachment_cleanup_errors: cleanup.errors.length > 0 ? cleanup.errors : null,
            attachment_cleanup_attempts: previousAttempts + 1,
            attachment_cleanup_last_attempt_at: new Date().toISOString(),
        })
        .eq("id", record.id);

    return {
        id: record.id,
        cleanup_status: finalStatus,
        attempts: previousAttempts + 1,
        drive: cleanup.drive,
        r2: cleanup.r2,
        errors: cleanup.errors,
        ignored: cleanup.ignored,
        update_error: updateErr ? updateErr.message : null,
    };
}

async function handleCleanupAction(req, res, body, url) {
    const idParam = body.id ?? url.searchParams.get("id");
    const id = idParam != null && idParam !== "" ? Number(idParam) : null;
    const batchSize = Number(body.batch_size ?? url.searchParams.get("batch_size") ?? DEFAULT_BATCH_SIZE);
    const maxAttempts = Number(body.max_attempts ?? url.searchParams.get("max_attempts") ?? DEFAULT_MAX_ATTEMPTS);

    if (req.method === "GET") {
        const candidates = await fetchCleanupCandidates({ id, batchSize, maxAttempts });
        return json(res, 200, {
            success: true,
            dry_run: true,
            count: candidates.length,
            max_attempts: maxAttempts,
            batch_size: batchSize,
            candidates: candidates.map(c => ({
                id: c.id,
                deleted_at: c.deleted_at,
                attachment_cleanup_status: c.attachment_cleanup_status,
                attachment_cleanup_attempts: c.attachment_cleanup_attempts,
                attachment_cleanup_last_attempt_at: c.attachment_cleanup_last_attempt_at,
                file_id: c.file_id,
                file_link_r2: c.file_link_r2,
                achieved_file_link: c.achieved_file_link,
            })),
        });
    }

    if (req.method !== "POST") {
        return json(res, 405, { success: false, message: "Method not allowed" });
    }

    let candidates;
    if (id != null) {
        const { data, error } = await supabase
            .from("invoices")
            .select("*")
            .eq("id", id)
            .single();
        if (error || !data) {
            return json(res, 404, { success: false, message: "Record not found" });
        }
        if (!data.deleted_at) {
            return json(res, 400, {
                success: false,
                message: "Record is not soft-deleted; refusing to clean up attachments.",
            });
        }
        candidates = [data];
    } else {
        candidates = await fetchCleanupCandidates({ id: null, batchSize, maxAttempts });
    }

    const results = [];
    for (const record of candidates) {
        try {
            results.push(await processCleanupRecord(record));
        } catch (e) {
            console.error(`[CLEANUP] Unhandled error for ${record.id}:`, e);
            results.push({ id: record.id, error: e?.message || String(e) });
        }
    }

    const successCount = results.filter(r => r.cleanup_status === "success").length;
    const failCount = results.filter(r => r.cleanup_status === "failed" || r.error).length;

    return json(res, 200, {
        success: true,
        processed: results.length,
        success_count: successCount,
        fail_count: failCount,
        max_attempts: maxAttempts,
        results,
    });
}

async function handleDeleteAction(body, res) {
    const { rowNumber } = body; // rowNumber is the Supabase invoices.id
    if (!rowNumber) {
        return json(res, 400, { success: false, message: "Missing record ID" });
    }

    // 1. Fetch the record so we know what attachments to clean up.
    const { data: record, error: fetchError } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", rowNumber)
        .single();

    if (fetchError || !record) {
        console.error("[DELETE] Fetch error:", fetchError);
        return json(res, 404, { success: false, message: "Record not found" });
    }

    const wasAlreadySoftDeleted = !!record.deleted_at;
    const previousAttempts = Number(record.attachment_cleanup_attempts) || 0;
    const nowIso = new Date().toISOString();

    // 2. Soft-delete the row immediately so the user sees it gone.
    //    Mark cleanup as pending so the retry worker / this request can pick it up.
    if (!wasAlreadySoftDeleted) {
        const { error: softErr } = await supabase
            .from("invoices")
            .update({
                deleted_at: nowIso,
                attachment_cleanup_status: "pending",
                attachment_cleanup_errors: null,
                attachment_cleanup_last_attempt_at: null,
            })
            .eq("id", rowNumber);

        if (softErr) {
            console.error("[DELETE] Soft-delete error:", softErr);
            return json(res, 500, {
                success: false,
                message: "Failed to mark record as deleted",
                details: { errors: [`Supabase: ${softErr.message}`] },
            });
        }
        console.log(`[DELETE] Soft-deleted invoice ${rowNumber}`);
    } else {
        console.log(`[DELETE] Invoice ${rowNumber} already soft-deleted, retrying cleanup (prev attempts=${previousAttempts})`);
    }

    // 3. Best-effort synchronous attachment cleanup (Drive + R2).
    const cleanup = await cleanupAttachments(record);
    const finalStatus = resolveCleanupStatus(cleanup);

    // 4. Write cleanup status back so the retry worker knows what to pick up.
    const { error: statusErr } = await supabase
        .from("invoices")
        .update({
            attachment_cleanup_status: finalStatus,
            attachment_cleanup_errors: cleanup.errors.length > 0 ? cleanup.errors : null,
            attachment_cleanup_attempts: previousAttempts + 1,
            attachment_cleanup_last_attempt_at: new Date().toISOString(),
        })
        .eq("id", rowNumber);

    if (statusErr) {
        console.error("[DELETE] Status writeback error:", statusErr);
        // We still report the soft-delete succeeded; the retry worker will
        // re-evaluate based on what it finds in the DB later.
    }

    const details = {
        soft_deleted: true,
        cleanup_status: finalStatus,
        drive: cleanup.drive,
        r2: cleanup.r2,
        errors: cleanup.errors,
        ignored: cleanup.ignored,
        attempts: previousAttempts + 1,
    };

    if (finalStatus === "success") {
        return json(res, 200, {
            success: true,
            message: "Record deleted successfully",
            details,
        });
    }

    // Soft delete done, but attachment cleanup is incomplete.
    // From the user's perspective the record is gone — the retry worker
    // will keep trying. Surface the partial state so the UI can explain it.
    return json(res, 200, {
        success: true,
        partial: true,
        message: "Record removed. Attachment cleanup is pending and will be retried automatically.",
        details,
    });
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
        }

        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const action = body.action ?? url.searchParams.get("action") ?? "delete";

        if (action === "cleanup") {
            return await handleCleanupAction(req, res, body, url);
        }

        if (req.method !== "POST") {
            return json(res, 405, { success: false, message: "Method not allowed" });
        }

        return await handleDeleteAction(body, res);
    } catch (e) {
        console.error("[DELETE] Global error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
