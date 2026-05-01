import { supabase } from "../lib/_supabase.js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { google } from "googleapis";
import { getDriveAuth } from "../lib/_sheets.js";

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

// R2 Configuration
const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, '');

// Drive Configuration
const drive = google.drive({ version: "v3", auth: getDriveAuth() });

function extractR2Key(r2Link) {
    if (!r2Link) return "";
    try {
        if (R2_PUBLIC_URL && r2Link.startsWith(R2_PUBLIC_URL)) {
            return r2Link.substring(R2_PUBLIC_URL.length).replace(/^\/+/, '');
        }
        const url = new URL(r2Link);
        return url.pathname.replace(/^\/+/, '');
    } catch {
        return "";
    }
}

async function deleteR2Object(r2Key) {
    if (!r2Key || !BUCKET_NAME) return { skipped: true };
    await r2.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: r2Key
    }));
    return { deleted: true, key: r2Key };
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return json(res, 405, { success: false, message: "Method not allowed" });
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        const { rowNumber } = body; // rowNumber is the Supabase ID

        if (!rowNumber) {
            return json(res, 400, { success: false, message: "Missing record ID" });
        }

        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
        }

        // 1. Fetch record from Supabase to get file info
        const { data: record, error: fetchError } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', rowNumber)
            .single();

        if (fetchError || !record) {
            console.error("[DELETE] Fetch error:", fetchError);
            return json(res, 404, { success: false, message: "Record not found" });
        }

        const driveFileId = record.file_id;
        const r2Links = [
            record.file_link_r2,
            record.achieved_file_link
        ].filter(Boolean);
        const r2Keys = new Set(r2Links.map(extractR2Key).filter(Boolean));
        if (record.achieved_file_id) {
            r2Keys.add(record.achieved_file_id);
        }
        const results = {
            supabase: false,
            r2: false,
            drive: false,
            errors: []
        };

        // 2. Delete from Google Drive
        if (driveFileId) {
            try {
                await drive.files.delete({
                    fileId: driveFileId,
                    supportsAllDrives: true
                });
                results.drive = true;
                console.log(`[DELETE] Deleted from Drive: ${driveFileId}`);
            } catch (err) {
                console.error(`[DELETE] Drive error for ${driveFileId}:`, err.message);
                results.errors.push(`Drive: ${err.message}`);
            }
        } else {
            results.drive = "skip (no id)";
        }

        // 3. Delete from R2 (both original and archived files)
        if (r2Keys.size > 0 && BUCKET_NAME) {
            const r2Failures = [];
            for (const r2Key of r2Keys) {
                try {
                    await deleteR2Object(r2Key);
                    console.log(`[DELETE] Deleted from R2: ${r2Key}`);
                } catch (err) {
                    console.error(`[DELETE] R2 error for ${r2Key}:`, err.message);
                    r2Failures.push(`${r2Key}: ${err.message}`);
                }
            }
            if (r2Failures.length === 0) {
                results.r2 = true;
            } else {
                results.r2 = false;
                results.errors.push(`R2: ${r2Failures.join(' | ')}`);
            }
        } else {
            results.r2 = "skip (no link/key)";
        }

        // 4. Only delete DB row after attachment cleanup succeeds.
        // This prevents orphaned files from being re-processed and re-ingested.
        if (results.errors.length > 0) {
            return json(res, 500, {
                success: false,
                message: "Attachment deletion failed. Database record is kept to avoid re-ingest.",
                details: results
            });
        }

        // 5. Delete from Supabase
        const { error: deleteError } = await supabase
            .from('invoices')
            .delete()
            .eq('id', rowNumber);

        if (deleteError) {
            console.error("[DELETE] Supabase error:", deleteError);
            results.errors.push(`Supabase: ${deleteError.message}`);
        } else {
            results.supabase = true;
            console.log(`[DELETE] Deleted from Supabase: ${rowNumber}`);
        }

        return json(res, 200, { 
            success: results.supabase, 
            message: results.supabase ? "Record deleted successfully" : "Failed to delete from database",
            details: results 
        });

    } catch (e) {
        console.error("[DELETE] Global error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
