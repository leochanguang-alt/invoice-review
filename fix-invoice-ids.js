/**
 * Fix Invoice_ID naming convention
 * Rule: {ProjectCode}-{4-digit sequence}-{amount}{currency}
 * Negative amounts use m prefix: -600 -> m600
 */

import 'dotenv/config';
import { google } from 'googleapis';

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

function toA1Column(n) {
    let s = "";
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
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

async function main() {
    console.log("=== Fix Invoice_ID ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Get all Project Codes from Projects sheet
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

    const invoiceIdIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'invoice_id' || h.toLowerCase() === 'invoice id'
    );
    const projectIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'charge to project' || h.toLowerCase() === 'chargetoproject'
    );
    const amountIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'amount'
    );
    const currencyIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'currency'
    );

    if (invoiceIdIdx === -1) {
        console.error("❌ Cannot find 'Invoice_ID' column in Main sheet");
        return;
    }

    console.log(`   Invoice_ID column index: ${invoiceIdIdx} (column ${toA1Column(invoiceIdIdx + 1)})\n`);

    // 3. Find rows that need fixing
    console.log("[STEP 3] Checking Invoice_IDs that need fixing...\n");

    const fixes = [];

    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const invoiceId = norm(row[invoiceIdIdx]);
        const projectCode = norm(row[projectIdx]);
        const amount = norm(row[amountIdx]);
        const currency = norm(row[currencyIdx]);
        const rowNum = i + 1;

        // Skip empty Invoice_ID
        if (!invoiceId) continue;

        // Parse current Invoice_ID to get sequence number
        const parts = invoiceId.split('-');
        if (parts.length < 3) continue;

        // Extract sequence number (second to last segment)
        let seqPart = parts[parts.length - 2];

        // Handle special case: BUI-2025-0851--600GBP (sequence is empty, need to find correct sequence)
        if (seqPart === '') {
            // This is a special case for negative amounts, sequence is in the segment before
            seqPart = parts[parts.length - 3];
        }

        // Validate sequence format
        if (!/^\d{4}$/.test(seqPart)) {
            // Try to extract 4-digit number from ID as sequence
            const seqMatch = invoiceId.match(/-(\d{4})-/);
            if (seqMatch) {
                seqPart = seqMatch[1];
            } else {
                console.log(`   ⚠️ Row ${rowNum}: Cannot extract sequence, skipping`);
                continue;
            }
        }

        // Calculate correct amount part
        const amountNum = parseFloat(amount.replace(/,/g, '')) || 0;
        let amountStr;
        if (amountNum < 0) {
            // Negative numbers use m prefix
            amountStr = 'm' + Math.abs(Math.round(amountNum));
        } else {
            amountStr = Math.round(amountNum).toString();
        }

        // Generate correct Invoice_ID
        const correctInvoiceId = `${projectCode}-${seqPart}-${amountStr}${currency}`;

        // Check if fix is needed
        if (invoiceId !== correctInvoiceId) {
            fixes.push({
                rowNumber: rowNum,
                oldId: invoiceId,
                newId: correctInvoiceId,
                projectCode,
                amount,
                currency
            });
        }
    }

    if (fixes.length === 0) {
        console.log("   ✅ All Invoice_IDs are correct, no fix needed!\n");
        return;
    }

    console.log(`   Need to fix ${fixes.length} Invoice_IDs:\n`);
    fixes.forEach(fix => {
        console.log(`   Row ${fix.rowNumber}:`);
        console.log(`      Old: "${fix.oldId}"`);
        console.log(`      New: "${fix.newId}"`);
        console.log("");
    });

    // 4. Batch update
    console.log("[STEP 4] Updating Invoice_IDs...");

    const invoiceIdCol = toA1Column(invoiceIdIdx + 1);
    const updates = fixes.map(fix => ({
        range: `${MAIN_SHEET}!${invoiceIdCol}${fix.rowNumber}`,
        values: [[fix.newId]]
    }));

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates
        }
    });

    console.log(`   ✅ Updated ${fixes.length} Invoice_IDs!\n`);

    // 5. Clear yellow marks
    console.log("[STEP 5] Clearing yellow marks...");

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties'
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === MAIN_SHEET);
    const mainSheetId = sheet.properties.sheetId;

    // Clear background color for all fixed rows
    const clearRequests = fixes.map(fix => ({
        repeatCell: {
            range: {
                sheetId: mainSheetId,
                startRowIndex: fix.rowNumber - 1,
                endRowIndex: fix.rowNumber,
                startColumnIndex: 0,
                endColumnIndex: mainHeaders.length
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: {
                        red: 1.0,
                        green: 1.0,
                        blue: 1.0,
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
            requests: clearRequests
        }
    });

    console.log(`   ✅ Cleared yellow marks for ${fixes.length} rows!\n`);

    console.log("=== Fix complete ===");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
