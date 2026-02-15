/**
 * Check if "Charge to Project" column in Main sheet exists in Projects table's "Project Code"
 * Mark rows with yellow background if not found
 */

import 'dotenv/config';
import { google } from 'googleapis';

// Reuse utility functions from _sheets.js
function cleanEnv(v) {
    if (!v) return "";
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    v = v.replace(/\\n$/, '');
    return v;
}

const SHEET_ID = cleanEnv(process.env.SHEET_ID);
const MAIN_SHEET = cleanEnv(process.env.MAIN_SHEET) || "Main";

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

function norm(v) {
    return (v ?? "").toString().trim();
}

function getDriveAuth() {
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
        console.log("[AUTH] Using OAuth2");
        const oauth2Client = new google.auth.OAuth2(
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
        return oauth2Client;
    }

    // Fallback to JWT (Service Account)
    const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;
    const email = cleanEnv(rawEmail);
    let key = cleanEnv(rawKey);

    if (!email || !key) {
        throw new Error("Missing auth env");
    }

    key = key.replace(/\\n/g, "\n");
    return new google.auth.JWT({
        email,
        key,
        scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive"
        ],
    });
}

async function getSheetId(sheets, sheetName) {
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties'
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
    }
    return sheet.properties.sheetId;
}

async function main() {
    console.log("=== Check Charge to Project Column ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Get all Project Codes from Projects table
    console.log("[STEP 1] Reading Projects sheet...");
    const projectsRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Projects!A:Z',
        valueRenderOption: 'FORMATTED_VALUE'
    });

    const projectsData = projectsRes.data.values || [];
    const projectsHeaders = (projectsData[0] || []).map(norm);
    const projectCodeIdx = projectsHeaders.findIndex(h =>
        h.toLowerCase() === 'project code' || h.toLowerCase() === 'projectcode'
    );

    if (projectCodeIdx === -1) {
        console.error("❌ Cannot find 'Project Code' column in Projects sheet");
        return;
    }

    // Collect all valid Project Codes (lowercase, for comparison)
    const validProjectCodes = new Set();
    for (let i = 1; i < projectsData.length; i++) {
        const code = norm(projectsData[i]?.[projectCodeIdx]);
        if (code) {
            validProjectCodes.add(code.toLowerCase());
        }
    }
    console.log(`   Found ${validProjectCodes.size} valid Project Codes\n`);

    // 2. Get Main sheet data
    console.log("[STEP 2] Reading Main sheet...");
    const mainRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${MAIN_SHEET}!A:Z`,
        valueRenderOption: 'FORMATTED_VALUE'
    });

    const mainData = mainRes.data.values || [];
    const mainHeaders = (mainData[0] || []).map(norm);
    const chargeToProjectIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'charge to project' || h.toLowerCase() === 'chargetoproject'
    );

    if (chargeToProjectIdx === -1) {
        console.error("❌ Cannot find 'Charge to Project' column in Main sheet");
        return;
    }

    console.log(`   Main sheet has ${mainData.length - 1} rows of data\n`);

    // 3. Check each row's Charge to Project
    console.log("[STEP 3] Checking invalid Project Codes...");
    const invalidRows = []; // Store row numbers to mark (1-based, including header)

    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const chargeToProject = norm(row[chargeToProjectIdx]);

        // Skip empty values
        if (!chargeToProject) continue;

        // Check if exists in valid Project Codes
        if (!validProjectCodes.has(chargeToProject.toLowerCase())) {
            const rowNum = i + 1; // Convert to 1-based row number
            invalidRows.push({
                rowNumber: rowNum,
                projectCode: chargeToProject,
                rowIndex: i
            });
        }
    }

    if (invalidRows.length === 0) {
        console.log("   ✅ All Charge to Project values are valid!\n");
        return;
    }

    console.log(`   ⚠️  Found ${invalidRows.length} rows with invalid Project Code:\n`);
    invalidRows.forEach(r => {
        console.log(`   - Row ${r.rowNumber}: "${r.projectCode}"`);
    });
    console.log("");

    // 4. Use formatting API to mark these rows yellow
    console.log("[STEP 4] Marking invalid rows yellow...");

    const mainSheetId = await getSheetId(sheets, MAIN_SHEET);

    // Build batch update request
    const requests = invalidRows.map(r => ({
        repeatCell: {
            range: {
                sheetId: mainSheetId,
                startRowIndex: r.rowIndex,      // 0-based
                endRowIndex: r.rowIndex + 1,    // exclusive
                startColumnIndex: 0,
                endColumnIndex: mainHeaders.length
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: {
                        red: 1.0,       // Yellow color
                        green: 1.0,
                        blue: 0.0,
                        alpha: 1.0
                    }
                }
            },
            fields: 'userEnteredFormat.backgroundColor'
        }
    }));

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            requests: requests
        }
    });

    console.log(`   ✅ Marked ${invalidRows.length} rows yellow!\n`);

    // 5. Print summary
    console.log("=== Summary ===");
    console.log(`Total rows: ${mainData.length - 1}`);
    console.log(`Invalid Project Code rows: ${invalidRows.length}`);
    console.log(`Valid Project Code list (${validProjectCodes.size} total):`);
    [...validProjectCodes].sort().forEach(code => console.log(`   - ${code}`));
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
