import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { google } from "googleapis";
import { getDriveAuth } from "./_sheets.js";

// Shared attachment cleanup helpers used by:
//   - api/delete-invoice.js  (best-effort sync cleanup right after soft delete)
//   - api/cleanup-attachments.js (async retry worker / manual retry endpoint)

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");

let _r2 = null;
function getR2() {
    if (_r2) return _r2;
    if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return null;
    }
    _r2 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    return _r2;
}

let _drive = null;
function getDrive() {
    if (_drive) return _drive;
    try {
        _drive = google.drive({ version: "v3", auth: getDriveAuth() });
        return _drive;
    } catch (e) {
        // Auth not configured. Caller decides whether that's a fatal error.
        return null;
    }
}

export function extractR2Key(r2Link) {
    if (!r2Link) return "";
    try {
        if (R2_PUBLIC_URL && r2Link.startsWith(R2_PUBLIC_URL)) {
            return r2Link.substring(R2_PUBLIC_URL.length).replace(/^\/+/, "");
        }
        const url = new URL(r2Link);
        return url.pathname.replace(/^\/+/, "");
    } catch {
        return "";
    }
}

// Map a record row (from invoices table) into the cleanup target list.
export function collectAttachmentTargets(record) {
    const driveFileId = record?.file_id || "";
    const r2Links = [record?.file_link_r2, record?.achieved_file_link, record?.archived_file_link]
        .filter(Boolean);
    const r2Keys = new Set(r2Links.map(extractR2Key).filter(Boolean));
    if (record?.achieved_file_id) r2Keys.add(record.achieved_file_id);
    if (record?.archived_file_id) r2Keys.add(record.archived_file_id);
    return { driveFileId, r2Keys: Array.from(r2Keys) };
}

// Detect "object/file no longer exists" — treated as success because the
// desired end state (gone) already holds. Exported for unit testing.
export function isDriveNotFound(err) {
    if (!err) return false;
    const code = err.code ?? err.status ?? err?.response?.status;
    if (code === 404) return true;
    const reason = err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason;
    if (reason === "notFound") return true;
    const msg = (err.message || "").toLowerCase();
    return msg.includes("file not found") || msg.includes("not found");
}

export function isR2NotFound(err) {
    if (!err) return false;
    if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") return true;
    const status = err?.$metadata?.httpStatusCode ?? err?.statusCode;
    if (status === 404) return true;
    const msg = (err.message || "").toLowerCase();
    return msg.includes("nosuchkey") || msg.includes("not found");
}

// Run cleanup for a single record. Returns:
//   {
//     drive:  true | false | "skipped",
//     r2:     true | false | "skipped",
//     errors: string[],            // user-facing details
//     ignored: string[],           // 404 / NoSuchKey, treated as success
//   }
export async function cleanupAttachments(record, { logger = console } = {}) {
    const { driveFileId, r2Keys } = collectAttachmentTargets(record);
    const result = {
        drive: "skipped",
        r2: "skipped",
        errors: [],
        ignored: [],
    };

    // Google Drive
    if (driveFileId) {
        const drive = getDrive();
        if (!drive) {
            result.drive = false;
            result.errors.push("Drive: client not configured");
        } else {
            try {
                await drive.files.delete({ fileId: driveFileId, supportsAllDrives: true });
                result.drive = true;
                logger.log?.(`[CLEANUP] Drive deleted: ${driveFileId}`);
            } catch (err) {
                if (isDriveNotFound(err)) {
                    result.drive = true;
                    result.ignored.push(`Drive ${driveFileId}: not found (treated as deleted)`);
                    logger.log?.(`[CLEANUP] Drive ${driveFileId} already gone, skipping`);
                } else {
                    result.drive = false;
                    result.errors.push(`Drive ${driveFileId}: ${err.message || String(err)}`);
                    logger.error?.(`[CLEANUP] Drive error ${driveFileId}:`, err.message || err);
                }
            }
        }
    }

    // R2 storage
    if (r2Keys.length > 0) {
        const r2 = getR2();
        if (!r2 || !BUCKET_NAME) {
            result.r2 = false;
            result.errors.push("R2: client not configured");
        } else {
            const failures = [];
            let okCount = 0;
            for (const key of r2Keys) {
                try {
                    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
                    okCount++;
                    logger.log?.(`[CLEANUP] R2 deleted: ${key}`);
                } catch (err) {
                    if (isR2NotFound(err)) {
                        okCount++;
                        result.ignored.push(`R2 ${key}: not found (treated as deleted)`);
                        logger.log?.(`[CLEANUP] R2 ${key} already gone, skipping`);
                    } else {
                        failures.push(`${key}: ${err.message || String(err)}`);
                        logger.error?.(`[CLEANUP] R2 error ${key}:`, err.message || err);
                    }
                }
            }
            if (failures.length === 0) {
                result.r2 = true;
            } else {
                result.r2 = okCount > 0 ? "partial" : false;
                result.errors.push(`R2: ${failures.join(" | ")}`);
            }
        }
    }

    return result;
}

// Convenience: derive a final cleanup status from a result object.
export function resolveCleanupStatus(result) {
    return result.errors.length === 0 ? "success" : "failed";
}
