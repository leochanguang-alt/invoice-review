import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';
import path from 'path';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

// Google Drive folder IDs
const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8'; // projects archive folder
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3"; // Test_invoice folder

// Local paths
const LOCAL_BUI_INVOICE = "c:/Users/LCG/.gemini/antigravity/scratch/invoice-review/bui_invoice";

// Recursively list all files in a Google Drive folder
async function listDriveFilesRecursive(folderId, prefix = '') {
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
            const fullPath = prefix ? `${prefix}/${file.name}` : file.name;

            if (file.mimeType === "application/vnd.google-apps.folder") {
                const subFiles = await listDriveFilesRecursive(file.id, fullPath);
                files.push(...subFiles);
            } else if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push({ name: file.name, path: fullPath, id: file.id });
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return files;
}

// List all files in local directory recursively
function listLocalFilesRecursive(dirPath, prefix = '') {
    const files = [];

    if (!fs.existsSync(dirPath)) {
        return files;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
            const subFiles = listLocalFilesRecursive(path.join(dirPath, entry.name), fullPath);
            files.push(...subFiles);
        } else {
            files.push({ name: entry.name, path: fullPath });
        }
    }

    return files;
}

async function compareFileNames() {
    console.log("=== Detailed File Name Comparison ===\n");

    // =====================================================
    // Part 1: Projects folder file names
    // =====================================================
    console.log("=".repeat(60));
    console.log("PART 1: PROJECTS FOLDER - FILE NAME COMPARISON");
    console.log("=".repeat(60));

    // Get Drive project folders
    const driveFoldersRes = await drive.files.list({
        q: `'${ARCHIVE_PARENT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id, name)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });
    const driveProjectFolders = driveFoldersRes.data.files || [];

    let allProjectFilesMatch = true;
    const projectMismatches = [];

    for (const projectFolder of driveProjectFolders) {
        const driveFiles = await listDriveFilesRecursive(projectFolder.id);
        const driveFileNames = driveFiles.map(f => f.name).sort();

        const localPath = path.join(LOCAL_BUI_INVOICE, 'projects', projectFolder.name);
        const localFiles = listLocalFilesRecursive(localPath);
        const localFileNames = localFiles.map(f => f.name).sort();

        const missingLocal = driveFileNames.filter(f => !localFileNames.includes(f));
        const extraLocal = localFileNames.filter(f => !driveFileNames.includes(f));

        if (missingLocal.length > 0 || extraLocal.length > 0) {
            allProjectFilesMatch = false;
            projectMismatches.push({
                project: projectFolder.name,
                missingLocal,
                extraLocal,
                driveCount: driveFileNames.length,
                localCount: localFileNames.length
            });
        }
    }

    if (allProjectFilesMatch) {
        console.log("\n✅ All project files match by name!");
    } else {
        console.log(`\n❌ Found ${projectMismatches.length} projects with file name differences:\n`);
        for (const m of projectMismatches) {
            console.log(`\n📁 ${m.project} (Drive: ${m.driveCount}, Local: ${m.localCount})`);
            if (m.missingLocal.length > 0) {
                console.log(`   Missing locally (${m.missingLocal.length}):`);
                m.missingLocal.slice(0, 5).forEach(f => console.log(`     - ${f}`));
                if (m.missingLocal.length > 5) console.log(`     ... and ${m.missingLocal.length - 5} more`);
            }
            if (m.extraLocal.length > 0) {
                console.log(`   Extra locally (${m.extraLocal.length}):`);
                m.extraLocal.slice(0, 5).forEach(f => console.log(`     + ${f}`));
                if (m.extraLocal.length > 5) console.log(`     ... and ${m.extraLocal.length - 5} more`);
            }
        }
    }

    // =====================================================
    // Part 2: Test_invoice / fr_google_drive file names
    // =====================================================
    console.log("\n" + "=".repeat(60));
    console.log("PART 2: TEST_INVOICE / FR_GOOGLE_DRIVE - FILE NAME COMPARISON");
    console.log("=".repeat(60));

    const driveTestFiles = await listDriveFilesRecursive(TEST_INVOICE_FOLDER_ID);
    const driveTestFileNames = driveTestFiles.map(f => f.name).sort();
    console.log(`\nGoogle Drive Test_invoice: ${driveTestFileNames.length} files`);

    // Local n8n_Test/Test_Receipt
    const localTestPath = path.join(LOCAL_BUI_INVOICE, 'n8n_Test', 'Test_Receipt ');
    const localTestFiles = listLocalFilesRecursive(localTestPath);
    const localTestFileNames = localTestFiles.map(f => f.name).sort();
    console.log(`Local n8n_Test/Test_Receipt: ${localTestFileNames.length} files`);

    const missingLocalTest = driveTestFileNames.filter(f => !localTestFileNames.includes(f));
    const extraLocalTest = localTestFileNames.filter(f => !driveTestFileNames.includes(f));

    console.log("\nFile name comparison:");
    if (missingLocalTest.length === 0 && extraLocalTest.length === 0) {
        console.log("✅ All Test_invoice files match by name!");
    } else {
        if (missingLocalTest.length > 0) {
            console.log(`\n❌ Missing locally (${missingLocalTest.length}):`);
            missingLocalTest.forEach(f => console.log(`   - ${f}`));
        }
        if (extraLocalTest.length > 0) {
            console.log(`\n⚠️ Extra locally (${extraLocalTest.length}):`);
            extraLocalTest.forEach(f => console.log(`   + ${f}`));
        }
    }

    // =====================================================
    // Summary
    // =====================================================
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));

    console.log("\nProjects folder:");
    if (allProjectFilesMatch) {
        console.log("  ✅ All files match");
    } else {
        console.log(`  ❌ ${projectMismatches.length} projects have file differences`);
    }

    console.log("\nTest_invoice folder:");
    console.log(`  - Drive: ${driveTestFileNames.length} files`);
    console.log(`  - Local: ${localTestFileNames.length} files`);
    console.log(`  - Missing locally: ${missingLocalTest.length}`);
    console.log(`  - Extra locally: ${extraLocalTest.length}`);

    // Return data for sync
    return {
        testInvoiceMissing: missingLocalTest,
        testInvoiceExtra: extraLocalTest,
        driveTestFiles
    };
}

compareFileNames().catch(console.error);
