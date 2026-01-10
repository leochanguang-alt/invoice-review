import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

// Google Drive folder IDs
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3"; // Test_invoice folder

// Local paths - sync to n8n_Test/Test_Receipt which maps to fr_google_drive
const LOCAL_TARGET = "c:/Users/LCG/.gemini/antigravity/scratch/invoice-review/bui_invoice/n8n_Test/Test_Receipt ";

// Sanitize filename for Windows (replace illegal characters like colons)
function sanitizeFilename(name) {
    return name.replace(/:/g, '_');
}

// Recursively sync files from Google Drive to local
async function syncDriveToLocal(folderId, localPath) {
    console.log(`\nSyncing: ${folderId} -> ${localPath}`);

    // Ensure local directory exists
    if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
        console.log(`Created directory: ${localPath}`);
    }

    let pageToken = null;
    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType, size)",
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        for (const file of res.data.files) {
            // Sanitize filename for Windows compatibility
            const safeFileName = sanitizeFilename(file.name);
            const localFilePath = path.join(localPath, safeFileName);

            if (file.mimeType === "application/vnd.google-apps.folder") {
                // Recurse into subfolder (also sanitize folder name)
                const safeFolderPath = path.join(localPath, safeFileName);
                await syncDriveToLocal(file.id, safeFolderPath);
            } else if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                // Check if file already exists locally
                if (fs.existsSync(localFilePath)) {
                    console.log(`⏭️ Skip (exists): ${safeFileName}`);
                    skippedCount++;
                    continue;
                }

                try {
                    console.log(`⬇️ Downloading: ${file.name} -> ${safeFileName}...`);

                    const response = await drive.files.get(
                        { fileId: file.id, alt: "media" },
                        { responseType: "stream" }
                    );

                    const writeStream = fs.createWriteStream(localFilePath);
                    await pipeline(response.data, writeStream);

                    console.log(`✅ Downloaded: ${safeFileName}`);
                    syncedCount++;
                } catch (err) {
                    console.error(`❌ Error downloading ${file.name}:`, err.message);
                    errorCount++;
                }
            } else {
                console.log(`⏭️ Skip (Google Doc): ${file.name}`);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return { syncedCount, skippedCount, errorCount };
}

async function main() {
    console.log("=== Syncing Google Drive Test_invoice to Local ===\n");
    console.log(`Source: Google Drive Test_invoice (${TEST_INVOICE_FOLDER_ID})`);
    console.log(`Target: ${LOCAL_TARGET}\n`);

    const startTime = Date.now();
    const result = await syncDriveToLocal(TEST_INVOICE_FOLDER_ID, LOCAL_TARGET);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n" + "=".repeat(50));
    console.log("SYNC COMPLETE");
    console.log("=".repeat(50));
    console.log(`✅ Downloaded: ${result.syncedCount} files`);
    console.log(`⏭️ Skipped (already exists): ${result.skippedCount} files`);
    console.log(`❌ Errors: ${result.errorCount} files`);
    console.log(`⏱️ Duration: ${duration} seconds`);

    // Verify final count
    const localFiles = fs.readdirSync(LOCAL_TARGET);
    console.log(`\n📁 Local folder now has: ${localFiles.length} files`);
}

main().catch(console.error);
