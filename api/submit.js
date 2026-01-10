import { supabase } from "./_supabase.js";
import { S3Client, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

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

        // Load projects from Supabase
        const { data: projects, error: projectsErr } = await supabase
            .from('projects')
            .select('project_code, project_name');

        if (projectsErr) {
            console.error("[SUBMIT] Failed to load projects:", projectsErr.message);
        }

        const validProjectCodes = new Set((projects || []).map(p => p.project_code));

        // Group records by project to generate sequence numbers
        const projectGroups = {};
        for (const record of records) {
            const key = record.projectCode || 'UNKNOWN';
            if (!projectGroups[key]) {
                projectGroups[key] = [];
            }
            projectGroups[key].push(record);
        }

        // Get existing Invoice_IDs from Supabase to determine next sequence for each project
        const { data: existingInvoices, error: invErr } = await supabase
            .from('invoices')
            .select('generated_invoice_id')
            .not('generated_invoice_id', 'is', null);

        if (invErr) {
            console.error("[SUBMIT] Failed to load existing invoices:", invErr.message);
        }

        const existingInvoiceIds = (existingInvoices || [])
            .map(inv => inv.generated_invoice_id || '')
            .filter(id => id);

        // Calculate next sequence number for each project
        const projectSequences = {};
        for (const projectCode of Object.keys(projectGroups)) {
            let maxSeq = 0;
            for (const invoiceId of existingInvoiceIds) {
                // Format: ProjectCode-Seq-AmountCurrency
                if (invoiceId.startsWith(projectCode + '-')) {
                    const remaining = invoiceId.substring(projectCode.length + 1);
                    const parts = remaining.split('-');
                    if (parts.length >= 1) {
                        const seqNum = parseInt(parts[0]);
                        if (!isNaN(seqNum) && seqNum > maxSeq) {
                            maxSeq = seqNum;
                        }
                    }
                }
            }
            projectSequences[projectCode] = maxSeq;
            console.log(`[SUBMIT] Project ${projectCode} max sequence: ${maxSeq}`);
        }

        const results = [];

        for (const record of records) {
            const { rowNumber, projectCode, amount, currency, fileId } = record;
            const recordId = rowNumber; // rowNumber is actually Supabase id
            console.log(`[SUBMIT] Processing record ${recordId}, fileId: "${fileId}", project: "${projectCode}"`);

            // Generate Invoice_ID
            const seq = ++projectSequences[projectCode || 'UNKNOWN'];
            const seqStr = seq.toString().padStart(4, '0');
            const amountStr = amount ? amount.toString().replace(/,/g, '') : '0';
            const amountNum = Math.round(parseFloat(amountStr) || 0);

            // Handle negative amounts with 'm' prefix
            const amountPart = amountNum < 0 ? `m${Math.abs(amountNum)}` : String(amountNum);
            const invoiceId = `${projectCode}-${seqStr}-${amountPart}${currency}`;

            // File Archiving to R2
            let archivedLink = "";
            let archivedFileId = "";

            if (fileId && fileId.trim() !== "") {
                try {
                    // Determine file extension from fileId (which could be filename or R2 key)
                    let originalKey = "";
                    let fileExtension = ".pdf"; // default

                    // Check if fileId is already an R2 key path
                    if (fileId.includes('/')) {
                        originalKey = fileId;
                        const parts = fileId.split('.');
                        if (parts.length > 1) {
                            fileExtension = '.' + parts[parts.length - 1];
                        }
                    } else {
                        // fileId is a Google Drive ID - we need to find the file in R2
                        // Try to find a matching file by searching for files containing this ID
                        // For now, assume it might be the filename or partial key
                        console.log(`[SUBMIT] Looking for file with ID: ${fileId}`);

                        // Try common patterns - the file might be in fr_google_drive
                        // We'll need to check if the file exists
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

                        // If still not found, try to get file link from Supabase record
                        if (!originalKey) {
                            const { data: recordData } = await supabase
                                .from('invoices')
                                .select('file_link, file_id')
                                .eq('id', recordId)
                                .single();

                            if (recordData?.file_link) {
                                // Extract path from R2 URL
                                const urlMatch = recordData.file_link.match(/bui_invoice\/.*$/);
                                if (urlMatch) {
                                    originalKey = urlMatch[0];
                                    const parts = originalKey.split('.');
                                    if (parts.length > 1) {
                                        fileExtension = '.' + parts[parts.length - 1];
                                    }
                                    console.log(`[SUBMIT] Found original key from file_link: ${originalKey}`);
                                }
                            }
                        }
                    }

                    if (originalKey) {
                        // Copy file to project folder with new name
                        const targetKey = `${R2_PROJECTS_PREFIX}/${projectCode}/${invoiceId}${fileExtension}`;

                        console.log(`[SUBMIT] Copying ${originalKey} -> ${targetKey}`);

                        await r2.send(new CopyObjectCommand({
                            Bucket: BUCKET_NAME,
                            CopySource: `${BUCKET_NAME}/${originalKey}`,
                            Key: targetKey
                        }));

                        archivedFileId = targetKey;
                        archivedLink = `${R2_PUBLIC_URL}/${targetKey}`;
                        console.log(`[SUBMIT] Archived OK: ${targetKey}`);
                    } else {
                        console.warn(`[SUBMIT] Could not locate original file for ID: ${fileId}`);
                    }

                } catch (archiveErr) {
                    console.error(`[SUBMIT] ARCHIVE ERROR for record ${recordId}:`, archiveErr.message);
                }
            } else {
                console.warn(`[SUBMIT] No fileId for record ${recordId}`);
            }

            // Update Supabase record
            const updateData = {
                status: 'Submitted',
                generated_invoice_id: invoiceId,
                updated_at: new Date().toISOString()
            };

            if (archivedLink) {
                updateData.archived_file_link = archivedLink;
            }
            if (archivedFileId) {
                updateData.archived_file_id = archivedFileId;
            }

            const { error: updateErr } = await supabase
                .from('invoices')
                .update(updateData)
                .eq('id', recordId);

            if (updateErr) {
                console.error(`[SUBMIT] Update error for record ${recordId}:`, updateErr.message);
                results.push({ recordId, success: false, error: updateErr.message });
            } else {
                console.log(`[SUBMIT] Successfully submitted record ${recordId} as ${invoiceId}`);
                results.push({ recordId, success: true, invoiceId, archivedLink });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return json(res, 200, {
            success: failCount === 0,
            message: `Submitted ${successCount} record(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
            submittedCount: successCount,
            results
        });

    } catch (e) {
        console.error('[SUBMIT] Error:', e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
