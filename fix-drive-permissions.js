/**
 * Check and fix Drive file sharing permissions
 * Newly uploaded files need to be set to "Anyone with the link can view" for iframe preview
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
    console.log("=== Check and fix Drive file sharing permissions ===\n");

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

    if (driveIdIdx === -1) {
        console.error("❌ Cannot find 'Drive_ID' or 'File_ID' column in Main sheet");
        return;
    }

    // Collect Drive_IDs from last 20 records (newly added records)
    const recentRecords = [];
    for (let i = Math.max(1, mainData.length - 20); i < mainData.length; i++) {
        const row = mainData[i] || [];
        const driveId = norm(row[driveIdIdx]);
        if (driveId && !driveId.startsWith('msg_')) {
            recentRecords.push({
                rowNumber: i + 1,
                driveId
            });
        }
    }

    console.log(`   Checking file permissions for recent ${recentRecords.length} records...\n`);

    // 2. Check and fix permissions for each file
    let fixed = 0;
    let alreadyShared = 0;
    let errors = 0;

    for (const item of recentRecords) {
        try {
            // Get current permissions
            const permissionsRes = await drive.permissions.list({
                fileId: item.driveId,
                fields: 'permissions(id, type, role)',
                supportsAllDrives: true
            });

            const permissions = permissionsRes.data.permissions || [];
            const hasPublicAccess = permissions.some(p => p.type === 'anyone');

            if (hasPublicAccess) {
                console.log(`   ✓ Row ${item.rowNumber}: Already has public access`);
                alreadyShared++;
            } else {
                // Add public access permission
                console.log(`   → Row ${item.rowNumber}: Adding public access permission...`);
                await drive.permissions.create({
                    fileId: item.driveId,
                    requestBody: {
                        type: 'anyone',
                        role: 'reader'
                    },
                    supportsAllDrives: true
                });
                console.log(`   ✓ Row ${item.rowNumber}: Permission added`);
                fixed++;
            }
        } catch (err) {
            console.log(`   ✗ Row ${item.rowNumber}: Error - ${err.message}`);
            errors++;
        }
    }

    // 3. Output results
    console.log("\n=== Results ===\n");
    console.log(`Records checked: ${recentRecords.length}`);
    console.log(`Already has public permission: ${alreadyShared}`);
    console.log(`Permissions fixed: ${fixed}`);
    console.log(`Errors: ${errors}`);

    if (fixed > 0) {
        console.log("\n✅ Permissions fixed, please refresh the page to retry preview!");
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
