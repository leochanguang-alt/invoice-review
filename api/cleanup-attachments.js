import { supabase } from "../lib/_supabase.js";
import { cleanupAttachments, resolveCleanupStatus } from "../lib/_attachment-cleanup.js";

// Retry worker / manual retry endpoint for invoice attachment cleanup.
//
// Usage:
//   GET  /api/cleanup-attachments                       -> dry run, list candidates
//   POST /api/cleanup-attachments                       -> retry all candidates (default batch=10)
//   POST /api/cleanup-attachments  body: { id: 123 }    -> retry one specific record
//   POST /api/cleanup-attachments  body: { batch_size, max_attempts }
//
// A record is a "candidate" when:
//   deleted_at IS NOT NULL
//   AND attachment_cleanup_status IN ('pending', 'failed')
//   AND attachment_cleanup_attempts < max_attempts
//
// The endpoint never re-creates rows; it only re-runs Drive + R2 deletion and
// updates `attachment_cleanup_status` / `attachment_cleanup_errors` /
// `attachment_cleanup_attempts` / `attachment_cleanup_last_attempt_at`.

const DEFAULT_MAX_ATTEMPTS = Number(process.env.CLEANUP_MAX_ATTEMPTS || 5);
const DEFAULT_BATCH_SIZE = Number(process.env.CLEANUP_BATCH_SIZE || 10);

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

async function fetchCandidates({ id, batchSize, maxAttempts }) {
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

async function processOne(record) {
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

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
        }

        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

        const idParam = body.id ?? url.searchParams.get("id");
        const id = idParam != null && idParam !== "" ? Number(idParam) : null;
        const batchSize = Number(body.batch_size ?? url.searchParams.get("batch_size") ?? DEFAULT_BATCH_SIZE);
        const maxAttempts = Number(body.max_attempts ?? url.searchParams.get("max_attempts") ?? DEFAULT_MAX_ATTEMPTS);

        if (req.method === "GET") {
            const candidates = await fetchCandidates({ id, batchSize, maxAttempts });
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
            candidates = await fetchCandidates({ id: null, batchSize, maxAttempts });
        }

        const results = [];
        for (const record of candidates) {
            try {
                results.push(await processOne(record));
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

    } catch (e) {
        console.error("[CLEANUP] Global error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
