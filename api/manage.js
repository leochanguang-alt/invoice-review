import { getSheetsClient, SHEET_ID, norm, json, toA1Column, getDriveAuth } from "./_sheets.js";
import { google } from "googleapis";

const PARENT_FOLDER_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';

// Sheet name mapping
const SHEET_MAP = {
    company: "Company_info",
    projects: "Projects",
    owner: "Invoice_Owner",
    main: "Main",
    currency_history: "C_Rate"
};

export default async function handler(req, res) {
    try {
        const sheets = getSheetsClient();

        if (req.method === "GET") {
            // List all rows from a sheet
            const sheetKey = req.query.sheet;
            const sheetName = SHEET_MAP[sheetKey];
            if (!sheetName) {
                return json(res, 400, { success: false, message: "Invalid sheet key" });
            }

            const dataRes = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `${sheetName}!A:Z`,
                valueRenderOption: "FORMATTED_VALUE",
            });

            const values = dataRes.data.values || [];
            if (values.length === 0) {
                return json(res, 200, { success: true, headers: [], data: [] });
            }

            const headers = values[0].map(norm);
            const data = [];
            for (let i = 1; i < values.length; i++) {
                const row = values[i];
                const item = { _rowNumber: i + 1 }; // 1-based row number for Google Sheets
                headers.forEach((h, idx) => {
                    item[h] = norm(row[idx]);
                });
                data.push(item);
            }

            return json(res, 200, { success: true, headers, data });

        } else if (req.method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
            const { action, sheet: sheetKey, rowNumber, data } = body;
            const sheetName = SHEET_MAP[sheetKey];

            if (!sheetName) {
                return json(res, 400, { success: false, message: "Invalid sheet key" });
            }

            if (action === "add") {
                // Get headers first
                const headersRes = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: `${sheetName}!1:1`,
                    valueRenderOption: "FORMATTED_VALUE",
                });
                const headers = (headersRes.data.values?.[0] || []).map(norm);

                // Build row values based on headers
                const rowValues = headers.map(h => data[h] || "");

                // Special handling for projects: Create Drive Folder
                if (sheetKey === "projects") {
                    console.log("[DEBUG] Project addition triggered. Data:", JSON.stringify(data));
                    try {
                        let folderName = "";

                        // 1. Robustly find any field that looks like a Project Code or Project Name
                        const findField = (queries) => {
                            const key = Object.keys(data).find(k => {
                                const nk = k.toLowerCase().replace(/[_\s]/g, '');
                                return queries.some(q => nk === q);
                            });
                            return key ? data[key] : null;
                        };

                        const projectCode = findField(['projectcode', 'code']);
                        const projectName = findField(['projectname', 'name', 'project']);

                        folderName = projectCode || projectName || "Unnamed_Project";
                        console.log("[DEBUG] Folder name determined:", folderName);

                        if (folderName) {
                            const driveAuth = getDriveAuth();
                            const drive = google.drive({ version: 'v3', auth: driveAuth });

                            // Check connectivity/permission to parent
                            console.log("[DEBUG] Checking parent folder visibility:", PARENT_FOLDER_ID);
                            try {
                                const parentMeta = await drive.files.get({ fileId: PARENT_FOLDER_ID, fields: 'id, name' });
                                console.log("[DEBUG] Parent folder accessible:", parentMeta.data.name);
                            } catch (e) {
                                console.error("[CRITICAL] Cannot access PARENT_FOLDER_ID. Check permissions for service account.", e.message);
                            }

                            // Create folder DIRECTLY inside PARENT_FOLDER_ID
                            const folderMeta = {
                                name: folderName,
                                mimeType: 'application/vnd.google-apps.folder',
                                parents: [PARENT_FOLDER_ID],
                            };

                            console.log("[DEBUG] Attempting drive.files.create with:", JSON.stringify(folderMeta));
                            const folderRes = await drive.files.create({
                                requestBody: folderMeta,
                                fields: 'id, webViewLink, name',
                            });

                            const folderLink = folderRes.data.webViewLink;
                            console.log("[DEBUG] SUCCESS: Created folder in Drive. ID:", folderRes.data.id, "Link:", folderLink);

                            // 2. Identify and update the correct column index for the link
                            const linkColIdx = headers.findIndex(h => {
                                const normH = h.toLowerCase().replace(/[_\s]/g, '');
                                return normH === 'drivefolderlink' || normH === 'drivefolder' || normH === 'folderlink';
                            });

                            if (linkColIdx !== -1) {
                                rowValues[linkColIdx] = folderLink;
                                console.log("[DEBUG] Link stored in rowValues at index:", linkColIdx);
                            } else {
                                console.warn("[DEBUG] Could not find a suitable 'Drive_Folder_Link' column in headers:", headers);
                            }
                        }
                    } catch (driveErr) {
                        console.error("[ERROR] Drive operation failed completely:", driveErr);
                    }
                }

                await sheets.spreadsheets.values.append({
                    spreadsheetId: SHEET_ID,
                    range: `${sheetName}!A:A`,
                    valueInputOption: "USER_ENTERED",
                    requestBody: { values: [rowValues] },
                });

                return json(res, 200, { success: true, message: "Row added" });

            } else if (action === "update") {
                if (!rowNumber) {
                    return json(res, 400, { success: false, message: "Missing rowNumber" });
                }

                const headersRes = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: `${sheetName}!1:1`,
                    valueRenderOption: "FORMATTED_VALUE",
                });
                const headers = (headersRes.data.values?.[0] || []).map(norm);

                const updates = [];
                headers.forEach((h, idx) => {
                    if (data[h] !== undefined) {
                        const col = toA1Column(idx + 1);
                        updates.push({
                            range: `${sheetName}!${col}${rowNumber}`,
                            values: [[data[h]]]
                        });
                    }
                });

                if (updates.length > 0) {
                    await sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId: SHEET_ID,
                        requestBody: { valueInputOption: "USER_ENTERED", data: updates },
                    });
                }

                return json(res, 200, { success: true, message: "Row updated" });

            } else if (action === "delete") {
                if (!rowNumber) {
                    return json(res, 400, { success: false, message: "Missing rowNumber" });
                }

                const sheetMetaRes = await sheets.spreadsheets.get({
                    spreadsheetId: SHEET_ID,
                    fields: "sheets(properties(sheetId,title))"
                });

                const sheetMeta = sheetMetaRes.data.sheets.find(s => s.properties.title === sheetName);
                if (!sheetMeta) {
                    return json(res, 400, { success: false, message: "Sheet not found" });
                }

                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    requestBody: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: sheetMeta.properties.sheetId,
                                    dimension: "ROWS",
                                    startIndex: rowNumber - 1,
                                    endIndex: rowNumber
                                }
                            }
                        }]
                    }
                });

                return json(res, 200, { success: true, message: "Row deleted" });
            }

            return json(res, 400, { success: false, message: "Invalid action" });
        }

        return json(res, 405, { error: "Method not allowed" });
    } catch (e) {
        console.error("Manage API Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
