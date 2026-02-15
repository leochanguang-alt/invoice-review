/**
 * Check if Google Drive project folder names match Project Code in Projects table
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

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

// Invoice archive parent folder ID
const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';

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

async function main() {
    console.log("=== Check Google Drive Project Folders ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

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
    const folderLinkIdx = projectsHeaders.findIndex(h =>
        h.toLowerCase().includes('drive') && h.toLowerCase().includes('folder')
    );

    const projectCodes = new Map(); // code -> {row, folderLink}
    for (let i = 1; i < projectsData.length; i++) {
        const code = norm(projectsData[i]?.[projectCodeIdx]);
        const folderLink = norm(projectsData[i]?.[folderLinkIdx]);
        if (code) {
            projectCodes.set(code.toLowerCase(), {
                code,
                row: i + 1,
                folderLink
            });
        }
    }
    console.log(`   Found ${projectCodes.size} Project Codes:\n`);
    for (const [key, val] of projectCodes) {
        console.log(`   - ${val.code}`);
        if (val.folderLink) {
            console.log(`     Link: ${val.folderLink}`);
        }
    }
    console.log("");

    // 2. List all subfolders under the archive folder in Google Drive
    console.log("[STEP 2] Reading Google Drive archive folder...");

    const foldersRes = await drive.files.list({
        q: `'${ARCHIVE_PARENT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
        orderBy: 'name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    const driveFolders = foldersRes.data.files || [];
    console.log(`   Found ${driveFolders.length} folders:\n`);

    const driveFolderNames = new Map(); // name.toLowerCase() -> {name, id, link}
    for (const folder of driveFolders) {
        console.log(`   - ${folder.name} (ID: ${folder.id})`);
        driveFolderNames.set(folder.name.toLowerCase(), {
            name: folder.name,
            id: folder.id,
            link: folder.webViewLink
        });
    }
    console.log("");

    // 3. Compare
    console.log("[STEP 3] Comparing Project Code and folder names...\n");

    const issues = [];

    // Check if each Project Code has a corresponding folder
    for (const [key, project] of projectCodes) {
        if (!driveFolderNames.has(key)) {
            issues.push({
                type: 'MISSING_FOLDER',
                projectCode: project.code,
                message: `Project Code "${project.code}" has no corresponding folder in Google Drive`
            });
        }
    }

    // Check if each folder has a corresponding Project Code
    for (const [key, folder] of driveFolderNames) {
        if (!projectCodes.has(key)) {
            issues.push({
                type: 'EXTRA_FOLDER',
                folderName: folder.name,
                folderId: folder.id,
                message: `Folder "${folder.name}" has no corresponding Project Code in Projects table`
            });
        }
    }

    // Check if names match exactly (case-sensitive)
    for (const [key, project] of projectCodes) {
        const folder = driveFolderNames.get(key);
        if (folder && folder.name !== project.code) {
            issues.push({
                type: 'CASE_MISMATCH',
                projectCode: project.code,
                folderName: folder.name,
                message: `Case mismatch: Project Code "${project.code}" vs folder name "${folder.name}"`
            });
        }
    }

    // 4. Output results
    console.log("=== Check Results ===\n");
    console.log(`Project Codes in Projects table: ${projectCodes.size}`);
    console.log(`Folders in Google Drive: ${driveFolders.length}`);
    console.log(`Issues found: ${issues.length}\n`);

    if (issues.length === 0) {
        console.log("✅ All Project Codes and folder names match perfectly!\n");
    } else {
        console.log("⚠️  Found the following issues:\n");

        const missingFolders = issues.filter(i => i.type === 'MISSING_FOLDER');
        const extraFolders = issues.filter(i => i.type === 'EXTRA_FOLDER');
        const caseMismatches = issues.filter(i => i.type === 'CASE_MISMATCH');

        if (missingFolders.length > 0) {
            console.log(`--- Missing Folders (${missingFolders.length}) ---`);
            missingFolders.forEach(i => console.log(`   ${i.message}`));
            console.log("");
        }

        if (extraFolders.length > 0) {
            console.log(`--- Extra Folders (${extraFolders.length}) ---`);
            extraFolders.forEach(i => console.log(`   ${i.message}`));
            console.log("");
        }

        if (caseMismatches.length > 0) {
            console.log(`--- Case Mismatches (${caseMismatches.length}) ---`);
            caseMismatches.forEach(i => console.log(`   ${i.message}`));
            console.log("");
        }
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
