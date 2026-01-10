import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';
import path from 'path';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";
const LOCAL_BUI_INVOICE = "c:/Users/LCG/.gemini/antigravity/scratch/invoice-review/bui_invoice";

// Sanitize for Windows comparison
function sanitizeFilename(name) {
    return name.replace(/:/g, '_');
}

async function listDriveFilesRecursive(folderId) {
    const files = [];
    let pageToken = null;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        for (const file of res.data.files) {
            if (file.mimeType === "application/vnd.google-apps.folder") {
                const subFiles = await listDriveFilesRecursive(file.id);
                files.push(...subFiles);
            } else if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push(file.name);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return files;
}

function listLocalFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return [];

    const files = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const subFiles = listLocalFiles(path.join(dirPath, entry.name));
            files.push(...subFiles);
        } else {
            files.push(entry.name);
        }
    }

    return files;
}

async function finalVerification() {
    console.log("=== FINAL FILE NAME VERIFICATION ===\n");

    // =====================================================
    // Part 1: Projects folder
    // =====================================================
    console.log("=".repeat(60));
    console.log("PART 1: PROJECTS FOLDERS");
    console.log("=".repeat(60));

    const driveFoldersRes = await drive.files.list({
        q: `'${ARCHIVE_PARENT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id, name)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });
    const driveProjectFolders = driveFoldersRes.data.files || [];

    let allMatch = true;
    const mismatches = [];

    for (const folder of driveProjectFolders) {
        const driveFiles = await listDriveFilesRecursive(folder.id);
        const driveFilesSanitized = driveFiles.map(sanitizeFilename).sort();

        const localPath = path.join(LOCAL_BUI_INVOICE, 'projects', folder.name);
        const localFiles = listLocalFiles(localPath).sort();

        const missing = driveFilesSanitized.filter(f => !localFiles.includes(f));
        const extra = localFiles.filter(f => !driveFilesSanitized.includes(f));

        if (missing.length > 0 || extra.length > 0) {
            allMatch = false;
            mismatches.push({ folder: folder.name, missing, extra });
        }
    }

    if (allMatch) {
        console.log("\n✅ All project file names match!");
        console.log(`   (${driveProjectFolders.length} projects verified)`);
    } else {
        console.log(`\n❌ Found mismatches in ${mismatches.length} projects:`);
        for (const m of mismatches) {
            console.log(`\n📁 ${m.folder}:`);
            if (m.missing.length > 0) {
                console.log(`   Missing locally: ${m.missing.join(', ')}`);
            }
            if (m.extra.length > 0) {
                console.log(`   Extra locally: ${m.extra.join(', ')}`);
            }
        }
    }

    // =====================================================
    // Part 2: Test_invoice folder
    // =====================================================
    console.log("\n" + "=".repeat(60));
    console.log("PART 2: TEST_INVOICE FOLDER");
    console.log("=".repeat(60));

    const driveTestFiles = await listDriveFilesRecursive(TEST_INVOICE_FOLDER_ID);
    const driveTestFilesSanitized = driveTestFiles.map(sanitizeFilename).sort();

    const localTestPath = path.join(LOCAL_BUI_INVOICE, 'n8n_Test', 'Test_Receipt ');
    const localTestFiles = listLocalFiles(localTestPath).sort();

    const missingTest = driveTestFilesSanitized.filter(f => !localTestFiles.includes(f));
    const extraTest = localTestFiles.filter(f => !driveTestFilesSanitized.includes(f));

    console.log(`\nGoogle Drive: ${driveTestFiles.length} files`);
    console.log(`Local: ${localTestFiles.length} files`);

    if (missingTest.length === 0 && extraTest.length === 0) {
        console.log("\n✅ All Test_invoice file names match!");
    } else {
        console.log(`\n❌ File name mismatches found:`);
        if (missingTest.length > 0) {
            console.log(`\n   Missing locally (${missingTest.length}):`);
            missingTest.forEach(f => console.log(`     - ${f}`));
        }
        if (extraTest.length > 0) {
            console.log(`\n   Extra locally (${extraTest.length}):`);
            extraTest.forEach(f => console.log(`     + ${f}`));
        }
    }

    // =====================================================
    // Summary
    // =====================================================
    console.log("\n" + "=".repeat(60));
    console.log("FINAL SUMMARY");
    console.log("=".repeat(60));

    const projectsOK = allMatch;
    const testOK = missingTest.length === 0 && extraTest.length === 0;

    console.log(`\nProjects folder: ${projectsOK ? '✅ SYNCED' : '❌ OUT OF SYNC'}`);
    console.log(`Test_invoice folder: ${testOK ? '✅ SYNCED' : '❌ OUT OF SYNC'}`);

    if (projectsOK && testOK) {
        console.log("\n🎉 ALL DIRECTORIES ARE FULLY SYNCHRONIZED!");
    }
}

finalVerification().catch(console.error);
