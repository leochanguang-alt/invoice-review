/**
 * Check if all Drive_IDs in the Main sheet are valid
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
    throw new Error("Missing OAuth2 credentials");
}

async function main() {
    console.log("=== Check Drive_ID Validity ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // 1. Get Main sheet data
    console.log("[STEP 1] Reading Main sheet...");
    const mainRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${MAIN_SHEET}!A:Z`,
        valueRenderOption: 'FORMATTED_VALUE'
    });

    const mainData = mainRes.data.values || [];
    const mainHeaders = (mainData[0] || []).map(norm);

    const driveIdIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'drive_id' || h.toLowerCase() === 'file_id'
    );
    const vendorIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'vendor' || h.toLowerCase() === 'vender'
    );
    const amountIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'amount'
    );

    if (driveIdIdx === -1) {
        console.error("❌ Cannot find 'Drive_ID' or 'File_ID' column in Main sheet");
        return;
    }

    console.log(`   Found Drive_ID column index: ${driveIdIdx}`);
    console.log(`   Main sheet has ${mainData.length - 1} rows of data\n`);

    // 2. Collect all Drive_IDs
    const driveIds = [];
    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const driveId = norm(row[driveIdIdx]);
        if (driveId) {
            driveIds.push({
                rowNumber: i + 1,
                driveId,
                vendor: norm(row[vendorIdx]),
                amount: norm(row[amountIdx])
            });
        }
    }

    console.log(`[STEP 2] Checking ${driveIds.length} Drive_IDs...\n`);

    // 3. Check each Drive_ID
    const invalid = [];
    const valid = [];
    let checked = 0;

    for (const item of driveIds) {
        checked++;
        if (checked % 50 === 0) {
            console.log(`   Checked ${checked}/${driveIds.length}...`);
        }

        try {
            const file = await drive.files.get({
                fileId: item.driveId,
                fields: 'id, name, mimeType, trashed',
                supportsAllDrives: true
            });

            if (file.data.trashed) {
                invalid.push({
                    ...item,
                    reason: 'File has been deleted (in trash)'
                });
            } else {
                valid.push(item);
            }
        } catch (err) {
            invalid.push({
                ...item,
                reason: err.message || 'Cannot access file'
            });
        }
    }

    // 4. Output results
    console.log("\n=== Check Results ===\n");
    console.log(`Total records: ${mainData.length - 1}`);
    console.log(`With Drive_ID: ${driveIds.length}`);
    console.log(`Without Drive_ID: ${mainData.length - 1 - driveIds.length}`);
    console.log(`Valid Drive_IDs: ${valid.length}`);
    console.log(`Invalid Drive_IDs: ${invalid.length}\n`);

    if (invalid.length === 0) {
        console.log("✅ All Drive_IDs are valid!\n");
    } else {
        console.log("⚠️  Found the following invalid Drive_IDs:\n");
        invalid.slice(0, 20).forEach(item => {
            console.log(`   Row ${item.rowNumber}:`);
            console.log(`      Drive_ID: ${item.driveId}`);
            console.log(`      Vendor: ${item.vendor}, Amount: ${item.amount}`);
            console.log(`      Reason: ${item.reason}`);
            console.log("");
        });

        if (invalid.length > 20) {
            console.log(`   ... and ${invalid.length - 20} more invalid Drive_IDs\n`);
        }
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
