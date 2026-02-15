/**
 * Fix Google Drive folder names
 * 1. Rename BUI-Ski-Icshgl-2512 -> BUI-Ski-Icshgl
 * 2. Delete Test_Folder_by_AI
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

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

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
    console.log("=== Fix Google Drive folders ===\n");

    const auth = getDriveAuth();
    const drive = google.drive({ version: 'v3', auth });

    // 1. Rename folder BUI-Ski-Icshgl-2512 -> BUI-Ski-Icshgl
    const oldFolderId = '1Zxc2crtysmtOa_f0tk83Pq3_WZN9DWOG';
    const newName = 'BUI-Ski-Icshgl';

    console.log("[STEP 1] Renaming folder...");
    console.log(`   Old name: BUI-Ski-Icshgl-2512`);
    console.log(`   New name: ${newName}`);

    try {
        await drive.files.update({
            fileId: oldFolderId,
            requestBody: {
                name: newName
            },
            supportsAllDrives: true
        });
        console.log("   ✅ Rename successful!\n");
    } catch (err) {
        console.error("   ❌ Rename failed:", err.message);
    }

    // 2. Delete test folder Test_Folder_by_AI
    const testFolderId = '10gC5Pi47DhpPD310qpX_EzYD9GPUDZcY';

    console.log("[STEP 2] Deleting test folder...");
    console.log(`   Folder: Test_Folder_by_AI`);

    try {
        await drive.files.delete({
            fileId: testFolderId,
            supportsAllDrives: true
        });
        console.log("   ✅ Delete successful!\n");
    } catch (err) {
        console.error("   ❌ Delete failed:", err.message);
    }

    console.log("=== Fix complete ===\n");
    console.log("Please run check-drive-folders.js again to verify results.");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
