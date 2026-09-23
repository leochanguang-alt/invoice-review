import { supabase } from "../lib/_supabase.js";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { copyAndVerifyArchive } from "../lib/invoice-archive.js";
import { reserveInvoiceNumber } from "../lib/invoice-number-reservation.js";
import { extensionFromOldKey } from "../lib/invoice-numbering.js";
import {
    buildSubmitMessage,
    requireSingleSubmittedUpdate,
} from "../lib/invoice-submission.js";
import { resolveAmountHkd } from "../lib/currency-hkd.js";

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
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
const R2_ORIGINAL_PREFIX = 'bui_invoice/original_files/fr_google_drive';
const R2_PROJECTS_PREFIX = 'bui_invoice/projects';

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return json(res, 405, { error: 'Method not allowed' });
    }

    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: 'Supabase client not initialized' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { records } = body;

        console.log(`[SUBMIT] Processing ${records?.length} records.`);
        if (!Array.isArray(records) || records.length === 0) {
            console.warn("[SUBMIT] No records provided.");
            return json(res, 400, { success: false, message: 'No records provided' });
        }

        const results = [];

        for (const record of records) {
            const { rowNumber, projectCode, amount, currency, fileId: inputFileId } = record;
            const recordId = rowNumber; // rowNumber is actually Supabase id
            let fileId = inputFileId || "";
            console.log(`[SUBMIT] Processing record ${recordId}, fileId: "${fileId}", project: "${projectCode}"`);

            // File Archiving to R2
            let archivedLink = "";
            let archivedFileId = "";

            // Robustness: always fetch DB record to obtain R2 link for fallback
            // (also fills fileId if request omitted it). Skip soft-deleted rows.
            let dbR2Link = "";
            let isSoftDeleted = false;
            let dbInvoice = null;
            try {
                const { data: recData } = await supabase
                    .from('invoices')
                    .select('file_id, file_link, file_link_r2, deleted_at, amount, currency, invoice_date, amount_hkd')
                    .eq('id', recordId)
                    .single();
                if (recData) {
                    dbInvoice = recData;
                    if (recData.deleted_at) {
                        isSoftDeleted = true;
                    } else {
                        if (!fileId || fileId.trim() === "") {
                            fileId = recData.file_id || "";
                        }
                        dbR2Link = recData.file_link_r2 || recData.file_link || "";
                    }
                }
            } catch (e) {
                console.warn(`[SUBMIT] Failed to lookup record ${recordId}:`, e.message);
            }

            if (isSoftDeleted) {
                console.warn(`[SUBMIT] Skipping soft-deleted record ${recordId}`);
                results.push({ recordId, success: false, error: 'Record is deleted' });
                continue;
            }

            let invoiceId;
            try {
                const reservation = await reserveInvoiceNumber(supabase, {
                    invoiceId: recordId,
                    projectCode,
                    amount,
                    currency,
                });
                invoiceId = reservation.generatedInvoiceId;
                console.log(
                    `[SUBMIT] Reserved ${invoiceId} (sequence ${reservation.projectSequence})`,
                );
            } catch (reservationErr) {
                console.error(
                    `[SUBMIT] RESERVATION ERROR for record ${recordId}:`,
                    reservationErr.message,
                );
                results.push({
                    recordId,
                    success: false,
                    error: reservationErr.message,
                });
                continue;
            }

            // Try to get original file path
            let originalKey = "";
            let fileExtension = ".pdf"; // default

            // Prefer extracting path from dbR2Link (most reliable source)
            if (dbR2Link) {
                // Handle URL-encoded paths (e.g., spaces encoded as %20)
                let decodedLink = dbR2Link;
                try {
                    decodedLink = decodeURIComponent(dbR2Link);
                } catch (e) {
                    // If decoding fails, use original link
                }
                
                const urlMatch = decodedLink.match(/bui_invoice\/.*$/);
                if (urlMatch) {
                    // Only strip a query string (?...). Keep '#' in the key — R2 object keys
                    // legitimately contain '#' (e.g. "Receipt from Mouse Tail Coffee #Hfu2.pdf"),
                    // and treating it as a URL fragment would truncate the key and break archiving.
                    originalKey = urlMatch[0].split('?', 1)[0];
                    fileExtension = extensionFromOldKey(originalKey);
                    console.log(`[SUBMIT] Found original key from DB R2 link: ${originalKey}`);
                }
            }

            // If not found from dbR2Link, try other methods
            if (!originalKey && fileId && fileId.trim() !== "") {
                try {
                    // Check if fileId is already an R2 key path
                    if (fileId.includes('/')) {
                        originalKey = fileId.split('?', 1)[0];
                        fileExtension = extensionFromOldKey(originalKey);
                    } else {
                        // fileId is a Google Drive ID - try to find the file in R2
                        console.log(`[SUBMIT] Looking for file with Google Drive ID: ${fileId}`);

                        const possibleExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

                        for (const ext of possibleExtensions) {
                            const testKey = `${R2_ORIGINAL_PREFIX}/${fileId}${ext}`;
                            try {
                                await r2.send(new HeadObjectCommand({
                                    Bucket: BUCKET_NAME,
                                    Key: testKey
                                }));
                                originalKey = testKey;
                                fileExtension = ext;
                                console.log(`[SUBMIT] Found file at: ${testKey}`);
                                break;
                            } catch (e) {
                                // File not found with this extension, continue
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[SUBMIT] Error looking for file: ${e.message}`);
                }
            }

            // Execute file copy
            if (originalKey) {
                try {
                    // Copy file to project folder with new name
                    const targetKey = `${R2_PROJECTS_PREFIX}/${projectCode}/${invoiceId}${fileExtension}`;

                    console.log(`[SUBMIT] Copying ${originalKey} -> ${targetKey}`);

                    ({ archivedFileId, archivedLink } = await copyAndVerifyArchive(r2, {
                        bucketName: BUCKET_NAME,
                        publicUrl: R2_PUBLIC_URL,
                        originalKey,
                        targetKey,
                    }));
                    console.log(`[SUBMIT] Archived OK: ${targetKey}`);
                } catch (archiveErr) {
                    console.error(`[SUBMIT] ARCHIVE ERROR for record ${recordId}:`, archiveErr.message);
                    results.push({
                        recordId,
                        success: false,
                        error: archiveErr.message,
                    });
                    continue;
                }
            } else {
                console.warn(`[SUBMIT] Could not locate original file for record ${recordId}, fileId: ${fileId}`);
                results.push({
                    recordId,
                    success: false,
                    error: 'Could not locate original file',
                });
                continue;
            }

            // Update Supabase record
            const updateData = {
                status: 'Submitted',
                achieved_file_link: archivedLink,
                achieved_file_id: archivedFileId,
                updated_at: new Date().toISOString()
            };
            const amountHkd = await resolveAmountHkd(supabase, dbInvoice);
            if (amountHkd != null) {
                updateData.amount_hkd = amountHkd;
                console.log(`[SUBMIT] Auto-calculated amount_hkd for ${recordId}: ${amountHkd}`);
            }

            const updateResult = await supabase
                .from('invoices')
                .update(updateData)
                .eq('id', recordId)
                .eq('generated_invoice_id', invoiceId)
                .select('id');

            try {
                requireSingleSubmittedUpdate(updateResult);
                console.log(`[SUBMIT] Successfully submitted record ${recordId} as ${invoiceId}`);
                results.push({ recordId, success: true, invoiceId, archivedLink });
            } catch (updateErr) {
                console.error(`[SUBMIT] Update error for record ${recordId}:`, updateErr.message);
                results.push({ recordId, success: false, error: updateErr.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return json(res, 200, {
            success: failCount === 0,
            message: buildSubmitMessage(results),
            submittedCount: successCount,
            results
        });

    } catch (e) {
        console.error('[SUBMIT] Error:', e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
