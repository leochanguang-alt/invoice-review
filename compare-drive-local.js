import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';
import path from 'path';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

// Google Drive folder IDs (based on existing scripts)
const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8'; // projects archive folder
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3"; // Test_invoice folder (inside n8n_Test)

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
                // Skip Google Docs native files
                files.push(fullPath);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return files;
}

// Get folder structure from Google Drive (just folders, returns name -> id mapping)
async function getDriveFolders(folderId) {
    const folders = [];
    let pageToken = null;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
            fields: "nextPageToken, files(id, name)",
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        for (const folder of res.data.files) {
            folders.push({ id: folder.id, name: folder.name });
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return folders;
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
            files.push(fullPath);
        }
    }

    return files;
}

// Get local folder names
function getLocalFolders(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
}

async function compare() {
    console.log("=== Comparing Google Drive with local bui_invoice ===\n");
    console.log("Mapping:");
    console.log("  - Google Drive 'Invoice Archive/projects' -> Local 'bui_invoice/projects'");
    console.log("  - Google Drive 'Test_invoice' (n8n_Test) -> Cloudflare R2 'fr_google_drive'\n");

    // =====================================================
    // Part 1: Compare projects folders
    // =====================================================
    console.log("=".repeat(60));
    console.log("PART 1: PROJECTS FOLDER COMPARISON");
    console.log("=".repeat(60));

    console.log("\n1. Listing Google Drive project folders...");
    const driveProjects = await getDriveFolders(ARCHIVE_PARENT_ID);
    console.log(`   Found ${driveProjects.length} project folders in Google Drive`);

    console.log("\n2. Listing local project folders...");
    const localProjectsPath = path.join(LOCAL_BUI_INVOICE, 'projects');
    const localProjects = getLocalFolders(localProjectsPath);
    console.log(`   Found ${localProjects.length} project folders locally`);

    // Compare project folder names
    const driveProjectNames = driveProjects.map(p => p.name).sort();
    const localProjectNamesSorted = localProjects.sort();

    const missingLocalProjects = driveProjectNames.filter(p => !localProjects.includes(p));
    const extraLocalProjects = localProjects.filter(p => !driveProjectNames.includes(p));

    console.log("\n3. Project folder comparison:");
    if (missingLocalProjects.length === 0 && extraLocalProjects.length === 0) {
        console.log("   ✅ All project folder names match!");
    } else {
        if (missingLocalProjects.length > 0) {
            console.log(`   ❌ Missing locally (${missingLocalProjects.length}):`);
            missingLocalProjects.forEach(p => console.log(`      - ${p}`));
        }
        if (extraLocalProjects.length > 0) {
            console.log(`   ⚠️ Extra locally (${extraLocalProjects.length}):`);
            extraLocalProjects.forEach(p => console.log(`      + ${p}`));
        }
    }

    // Compare file counts per project
    console.log("\n4. File count comparison per project:");
    let totalDriveFiles = 0;
    let totalLocalFiles = 0;
    let projectsInSync = 0;
    let projectsOutOfSync = 0;
    const outOfSyncProjects = [];

    for (const project of driveProjects) {
        const driveFiles = await listDriveFilesRecursive(project.id);
        const localFiles = listLocalFilesRecursive(path.join(localProjectsPath, project.name));

        totalDriveFiles += driveFiles.length;
        totalLocalFiles += localFiles.length;

        if (driveFiles.length === localFiles.length) {
            projectsInSync++;
        } else {
            projectsOutOfSync++;
            outOfSyncProjects.push({
                name: project.name,
                driveCount: driveFiles.length,
                localCount: localFiles.length,
                diff: driveFiles.length - localFiles.length
            });
        }
    }

    console.log(`   Projects in sync: ${projectsInSync}`);
    console.log(`   Projects out of sync: ${projectsOutOfSync}`);
    console.log(`   Total files - Drive: ${totalDriveFiles}, Local: ${totalLocalFiles}`);

    if (outOfSyncProjects.length > 0) {
        console.log("\n   Out of sync projects:");
        outOfSyncProjects.forEach(p => {
            const arrow = p.diff > 0 ? '↓' : '↑';
            console.log(`     ${arrow} ${p.name}: Drive=${p.driveCount}, Local=${p.localCount} (${p.diff > 0 ? '+' : ''}${p.diff})`);
        });
    }

    // =====================================================
    // Part 2: Test_invoice folder (fr_google_drive mapping)
    // =====================================================
    console.log("\n" + "=".repeat(60));
    console.log("PART 2: TEST_INVOICE / FR_GOOGLE_DRIVE COMPARISON");
    console.log("=".repeat(60));

    console.log("\n1. Listing Google Drive Test_invoice folder...");
    const driveTestInvoiceFiles = await listDriveFilesRecursive(TEST_INVOICE_FOLDER_ID);
    console.log(`   Found ${driveTestInvoiceFiles.length} files in Google Drive Test_invoice`);

    // Check local n8n_Test/Test_Receipt folder
    const localTestReceiptPath = path.join(LOCAL_BUI_INVOICE, 'n8n_Test', 'Test_Receipt ');
    const localTestReceiptFiles = listLocalFilesRecursive(localTestReceiptPath);
    console.log(`   Found ${localTestReceiptFiles.length} files in local n8n_Test/Test_Receipt`);

    if (driveTestInvoiceFiles.length === localTestReceiptFiles.length) {
        console.log("   ✅ File counts match!");
    } else {
        console.log(`   ❌ File count mismatch: Drive=${driveTestInvoiceFiles.length}, Local=${localTestReceiptFiles.length}`);

        // Find differences
        const missingLocally = driveTestInvoiceFiles.filter(f => !localTestReceiptFiles.includes(f));
        const extraLocally = localTestReceiptFiles.filter(f => !driveTestInvoiceFiles.includes(f));

        if (missingLocally.length > 0) {
            console.log(`\n   Missing locally (${missingLocally.length}):`);
            missingLocally.slice(0, 10).forEach(f => console.log(`      - ${f}`));
            if (missingLocally.length > 10) console.log(`      ... and ${missingLocally.length - 10} more`);
        }
        if (extraLocally.length > 0) {
            console.log(`\n   Extra locally (${extraLocally.length}):`);
            extraLocally.slice(0, 10).forEach(f => console.log(`      + ${f}`));
            if (extraLocally.length > 10) console.log(`      ... and ${extraLocally.length - 10} more`);
        }
    }

    // =====================================================
    // Summary
    // =====================================================
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`\nProjects folder:`);
    console.log(`  - Google Drive: ${driveProjects.length} folders, ${totalDriveFiles} files`);
    console.log(`  - Local bui_invoice/projects: ${localProjects.length} folders, ${totalLocalFiles} files`);
    console.log(`  - In sync: ${projectsInSync}/${driveProjects.length} projects`);

    console.log(`\nTest_invoice / fr_google_drive:`);
    console.log(`  - Google Drive Test_invoice: ${driveTestInvoiceFiles.length} files`);
    console.log(`  - Local n8n_Test/Test_Receipt: ${localTestReceiptFiles.length} files`);

    console.log("\n=== Comparison Complete ===");
}

compare().catch(console.error);
