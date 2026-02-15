/**
 * Check if Invoice_ID in Main sheet follows naming convention
 * Rule: {ProjectCode}-{4-digit sequence}-{amount integer}{currency}
 * Example: BUI-2512-0001-100HKD
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
    console.log("=== Check Invoice_ID naming convention ===\n");
    console.log("Rule: {ProjectCode}-{4-digit sequence}-{amount integer}{currency}");
    console.log("Example: BUI-2512-0001-100HKD\n");

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

    // Find required column indices
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
    const statusIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'status'
    );

    if (invoiceIdIdx === -1) {
        console.error("❌ Cannot find 'Invoice_ID' column in Main sheet");
        return;
    }

    console.log(`   Main sheet has ${mainData.length - 1} rows of data\n`);

    // 3. Check each row's Invoice_ID
    console.log("[STEP 3] Checking Invoice_ID format...\n");

    const issues = [];
    let checkedCount = 0;
    let emptyCount = 0;
    let validCount = 0;

    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const invoiceId = norm(row[invoiceIdIdx]);
        const projectCode = norm(row[projectIdx]);
        const amount = norm(row[amountIdx]);
        const currency = norm(row[currencyIdx]);
        const status = norm(row[statusIdx]);
        const rowNum = i + 1;

        // Skip empty Invoice_ID (unsubmitted records)
        if (!invoiceId) {
            emptyCount++;
            continue;
        }

        checkedCount++;

        // Parse Invoice_ID
        // Format: ProjectCode-Seq-AmountCurrency
        // Example: BUI-2512-0001-100HKD

        const issueList = [];

        // Try to match format
        // ProjectCode may contain multiple "-", so we search from end to beginning
        const parts = invoiceId.split('-');

        if (parts.length < 3) {
            issues.push({
                rowNumber: rowNum,
                invoiceId,
                projectCode,
                amount,
                currency,
                issue: `Format error: should have at least 3 parts (separated by -), currently only ${parts.length} parts`
            });
            continue;
        }

        // Last part is AmountCurrency (e.g. 100HKD)
        const lastPart = parts[parts.length - 1];
        // Second to last part is sequence number (e.g. 0001)
        const seqPart = parts[parts.length - 2];
        // Everything before is ProjectCode
        const projectCodePart = parts.slice(0, parts.length - 2).join('-');

        // Check sequence number format (should be 4 digits)
        if (!/^\d{4}$/.test(seqPart)) {
            issueList.push(`Sequence format error: "${seqPart}" should be 4 digits`);
        }

        // Check AmountCurrency format
        // Supports 'm' prefix for negative amounts, e.g. m600GBP means -600 GBP
        const amountCurrencyMatch = lastPart.match(/^(m?)(\d+)([A-Za-z]+)$/);
        if (!amountCurrencyMatch) {
            issueList.push(`Amount currency format error: "${lastPart}" should be "amount+currency" like "100HKD" or "m600GBP"`);
        } else {
            const isNegative = amountCurrencyMatch[1] === 'm';
            const idAmountNum = parseInt(amountCurrencyMatch[2]);
            const idCurrency = amountCurrencyMatch[3];
            const actualAmount = isNegative ? -idAmountNum : idAmountNum;

            // Check if currency matches
            if (currency && idCurrency.toUpperCase() !== currency.toUpperCase()) {
                issueList.push(`Currency mismatch: ID has "${idCurrency}", record has "${currency}"`);
            }

            // Check if amount matches (integer part)
            if (amount) {
                const expectedAmount = Math.round(parseFloat(amount.replace(/,/g, '')) || 0);
                if (expectedAmount !== actualAmount) {
                    issueList.push(`Amount mismatch: ID has ${actualAmount}, record has ${expectedAmount}`);
                }
            }
        }

        // Check if ProjectCode matches
        if (projectCode && projectCodePart.toLowerCase() !== projectCode.toLowerCase()) {
            issueList.push(`ProjectCode mismatch: ID has "${projectCodePart}", record has "${projectCode}"`);
        }

        // Check if ProjectCode is valid
        if (!validProjectCodes.has(projectCodePart.toLowerCase())) {
            issueList.push(`Invalid ProjectCode: "${projectCodePart}" not in Projects sheet`);
        }

        if (issueList.length > 0) {
            issues.push({
                rowNumber: rowNum,
                invoiceId,
                projectCode,
                amount,
                currency,
                issue: issueList.join('; ')
            });
        } else {
            validCount++;
        }
    }

    // 4. Output results
    console.log("=== Check Results ===\n");
    console.log(`Total rows: ${mainData.length - 1}`);
    console.log(`Empty Invoice_ID (unsubmitted): ${emptyCount}`);
    console.log(`Checked Invoice_IDs: ${checkedCount}`);
    console.log(`Format correct: ${validCount}`);
    console.log(`Issues found: ${issues.length}\n`);

    if (issues.length === 0) {
        console.log("✅ All Invoice_ID formats are correct!\n");
        return;
    }

    console.log("⚠️  Found the following issues:\n");
    issues.forEach(issue => {
        console.log(`Row ${issue.rowNumber}:`);
        console.log(`   Invoice_ID: "${issue.invoiceId}"`);
        console.log(`   Project: "${issue.projectCode}", Amount: "${issue.amount}", Currency: "${issue.currency}"`);
        console.log(`   Issue: ${issue.issue}`);
        console.log("");
    });

    // 5. Mark problematic rows yellow
    console.log("[STEP 4] Marking problematic rows yellow...");

    const mainSheetId = await getSheetId(sheets, MAIN_SHEET);

    const requests = issues.map(issue => ({
        repeatCell: {
            range: {
                sheetId: mainSheetId,
                startRowIndex: issue.rowNumber - 1,
                endRowIndex: issue.rowNumber,
                startColumnIndex: 0,
                endColumnIndex: mainHeaders.length
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: {
                        red: 1.0,
                        green: 1.0,
                        blue: 0.0,
                        alpha: 1.0
                    }
                }
            },
            fields: 'userEnteredFormat.backgroundColor'
        }
    }));

    if (requests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                requests: requests
            }
        });
        console.log(`   ✅ Marked ${issues.length} rows yellow!\n`);
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
