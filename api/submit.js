import { getSheetsClient, SHEET_ID, MAIN_SHEET, norm, json, toA1Column, buildHeaderIndex, getDriveAuth } from "./_sheets.js";
import { google } from "googleapis";

const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return json(res, 405, { error: 'Method not allowed' });
    }

    try {
        const sheets = getSheetsClient();
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { records } = body;

        console.log(`[SUBMIT] Processing ${records?.length} records.`);
        if (!Array.isArray(records) || records.length === 0) {
            console.warn("[SUBMIT] No records provided.");
            return json(res, 400, { success: false, message: 'No records provided' });
        }

        const driveAuth = getDriveAuth();
        const drive = google.drive({ version: 'v3', auth: driveAuth });

        // Get headers to find column indexes
        const mainHeadersRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${MAIN_SHEET}!1:1`,
            valueRenderOption: "FORMATTED_VALUE",
        });
        const headers = (mainHeadersRes.data.values?.[0] || []).map(norm);
        const headerMap = buildHeaderIndex(headers);
        console.log("[SUBMIT] Headers:", JSON.stringify(headers));

        // Find column indexes
        const statusColIdx = headerMap.get('Status');
        const invoiceIdColIdx = headerMap.get('Invoice_ID') ?? headerMap.get('Invoice ID') ?? headerMap.get('invoice_id');
        const achiveLinkColIdx = headerMap.get('Achieved_File_link') ?? headerMap.get('Achieved_File_Link');
        const achiveIdColIdx = headerMap.get('Achieved_File_ID');

        console.log("[SUBMIT] Indices:", { statusColIdx, invoiceIdColIdx, achiveLinkColIdx, achiveIdColIdx });

        if (statusColIdx === undefined) {
            console.error("[SUBMIT] Status column missing.");
            return json(res, 400, { success: false, message: 'Status column not found' });
        }

        // 1. Load Projects mapping
        const projectsRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `Projects!A:Z`,
            valueRenderOption: "FORMATTED_VALUE",
        });
        const projectsValues = projectsRes.data.values || [];
        const projectsHeaders = (projectsValues[0] || []).map(norm);
        const projectsHeaderMap = buildHeaderIndex(projectsHeaders);
        const pCodeIdx = projectsHeaderMap.get('Project Code') ?? projectsHeaderMap.get('ProjectCode');
        const pLinkIdx = projectsHeaderMap.get('Drive_Folder_Link') ?? projectsHeaderMap.get('Drive Folder Link');

        const projectFolderMap = {};
        for (let i = 1; i < projectsValues.length; i++) {
            const row = projectsValues[i];
            const pCode = norm(row[pCodeIdx]);
            const pLink = norm(row[pLinkIdx]);
            if (pCode && pLink) {
                // Extract ID from URL: https://drive.google.com/drive/folders/ID
                const match = pLink.match(/folders\/([a-zA-Z0-9_-]+)/);
                if (match) {
                    projectFolderMap[pCode] = match[1];
                }
            }
        }
        console.log("[SUBMIT] Project Folder Map loaded for codes:", Object.keys(projectFolderMap));

        // Group records by project to generate sequence numbers
        const projectGroups = {};
        for (const record of records) {
            const key = record.projectCode || 'UNKNOWN';
            if (!projectGroups[key]) {
                projectGroups[key] = [];
            }
            projectGroups[key].push(record);
        }

        // Get existing Invoice_IDs to determine next sequence for each project
        let existingInvoiceIds = [];
        if (invoiceIdColIdx !== undefined) {
            const col = toA1Column(invoiceIdColIdx + 1);
            const invoiceIdRes = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `${MAIN_SHEET}!${col}2:${col}`,
                valueRenderOption: "FORMATTED_VALUE",
            });
            existingInvoiceIds = (invoiceIdRes.data.values || []).map(row => norm(row[0] || ''));
        }

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
                        const seqPart = parts[0];
                        const seqNum = parseInt(seqPart);
                        if (!isNaN(seqNum) && seqNum > maxSeq) {
                            maxSeq = seqNum;
                        }
                    }
                }
            }
            projectSequences[projectCode] = maxSeq;
            console.log(`[SUBMIT] Project ${projectCode} max sequence: ${maxSeq}`);
        }

        // Prepare batch update data
        const updates = [];

        for (const record of records) {
            const { rowNumber, companyId, projectCode, amount, currency, fileId } = record;
            console.log(`[SUBMIT] Record row ${rowNumber}, fileId: "${fileId}", project: "${projectCode}"`);

            // Generate Invoice_ID
            const seq = ++projectSequences[projectCode || 'UNKNOWN'];
            const seqStr = seq.toString().padStart(4, '0');
            const amountNum = Math.round(parseFloat(amount.replace(/,/g, '')) || 0);
            const invoiceId = `${projectCode}-${seqStr}-${amountNum}${currency}`;

            // 1. File Archiving
            let archivedLink = "";
            let archivedId = "";
            if (fileId && fileId.trim() !== "") {
                try {
                    let folderId = projectFolderMap[projectCode];

                    if (!folderId) {
                        console.warn(`[SUBMIT] No folder ID in map for project: ${projectCode}. Falling back to search.`);
                        const listRes = await drive.files.list({
                            q: `name = '${projectCode.replace(/'/g, "\\'")}' and '${ARCHIVE_PARENT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                            fields: 'files(id)',
                            supportsAllDrives: true,
                            includeItemsFromAllDrives: true
                        });
                        if (listRes.data.files?.length > 0) {
                            folderId = listRes.data.files[0].id;
                        }
                    }

                    if (folderId) {
                        console.log(`[SUBMIT] Copying ${fileId} -> ${folderId} as ${invoiceId}`);
                        const copyRes = await drive.files.copy({
                            fileId: fileId,
                            requestBody: {
                                name: invoiceId, // Rename to Invoice_ID
                                parents: [folderId]
                            },
                            fields: 'id, webViewLink',
                            supportsAllDrives: true
                        });
                        archivedId = copyRes.data.id;
                        archivedLink = copyRes.data.webViewLink;
                        console.log(`[SUBMIT] Archived OK: ${archivedId}`);
                    } else {
                        console.error(`[SUBMIT] Could not find or create folder for project: ${projectCode}`);
                    }
                } catch (driveErr) {
                    console.error(`[SUBMIT] ARCHIVE ERROR for row ${rowNumber}:`, driveErr.message);
                }
            } else {
                console.warn(`[SUBMIT] No fileId for row ${rowNumber}`);
            }

            // 2. Prepare Updates
            // Status -> Submitted
            const statusCol = toA1Column(statusColIdx + 1);
            updates.push({
                range: `${MAIN_SHEET}!${statusCol}${rowNumber}`,
                values: [['Submitted']]
            });

            // Invoice_ID
            if (invoiceIdColIdx !== undefined) {
                const col = toA1Column(invoiceIdColIdx + 1);
                updates.push({
                    range: `${MAIN_SHEET}!${col}${rowNumber}`,
                    values: [[invoiceId]]
                });
            }

            // Achieved_File_link
            if (achiveLinkColIdx !== undefined && archivedLink) {
                const col = toA1Column(achiveLinkColIdx + 1);
                updates.push({
                    range: `${MAIN_SHEET}!${col}${rowNumber}`,
                    values: [[archivedLink]]
                });
            }

            // Achieved_File_ID
            if (achiveIdColIdx !== undefined && archivedId) {
                const col = toA1Column(achiveIdColIdx + 1);
                updates.push({
                    range: `${MAIN_SHEET}!${col}${rowNumber}`,
                    values: [[archivedId]]
                });
            }
        }

        console.log(`[SUBMIT] Sending batch update with ${updates.length} cell changes.`);
        if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: updates
                }
            });
            console.log("[SUBMIT] Batch update successful.");
        }

        return json(res, 200, {
            success: true,
            message: `Successfully submitted and archived ${records.length} record(s)`,
            submittedCount: records.length
        });

    } catch (e) {
        console.error('Submit API Error:', e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
