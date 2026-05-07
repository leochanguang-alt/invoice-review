import { supabase } from "../lib/_supabase.js";
import { cleanupAttachments, resolveCleanupStatus } from "../lib/_attachment-cleanup.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return json(res, 405, { success: false, message: "Method not allowed" });
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const { rowNumber } = body; // rowNumber is the Supabase invoices.id

        if (!rowNumber) {
            return json(res, 400, { success: false, message: "Missing record ID" });
        }

        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
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

    } catch (e) {
        console.error("[DELETE] Global error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
