import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";
const LOCAL_TARGET = "c:/Users/LCG/.gemini/antigravity/scratch/invoice-review/bui_invoice/n8n_Test/Test_Receipt ";

// Files with colons that failed to download
const PROBLEM_FILES = [
    "Scanned 2 Jan 2026 at 15:34:52.pdf",
    "Scanned 29 Dec 2025 at 15:55:53.pdf",
    "Scanned 29 Dec 2025 at 16:19:07.pdf",
    "Scanned 29 Dec 2025 at 19:30:46.pdf",
    "Scanned 29 Dec 2025 at 19:33:34.pdf",
    "Scanned 29 Dec 2025 at 19:33:50.pdf",
    "Scanned 31 Dec 2025 at 13:19:54.pdf",
    "Scanned 4 Jan 2026 at 20:09:31.pdf",
    "Scanned 4 Jan 2026 at 21:01:21.pdf",
    "Scanned 7 Jan 2026 at 23:06:43.pdf",
    "Scanned 8 Jan 2026 at 21:31:13.pdf",
    "Your e-ticket receipt XXSTAD: 13 Feb 2026 11:35.pdf"
];

// Sanitize filename for Windows (replace illegal characters)
function sanitizeFilename(name) {
    // Replace colons with underscores (common for Windows compatibility)
    return name.replace(/:/g, '_');
}

async function syncProblemFiles() {
    console.log("=== Syncing Files with Special Characters ===\n");
    console.log(`Target: ${LOCAL_TARGET}\n`);

    // Get all files from Drive
    let pageToken = null;
    const allFiles = [];

    do {
        const res = await drive.files.list({
            q: `'${TEST_INVOICE_FOLDER_ID}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        for (const file of res.data.files) {
            if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                allFiles.push(file);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    console.log(`Found ${allFiles.length} total files in Drive\n`);

    // Find and download problem files
    let downloadedCount = 0;
    let errorCount = 0;

    for (const problemFileName of PROBLEM_FILES) {
        const file = allFiles.find(f => f.name === problemFileName);

        if (!file) {
            console.log(`❌ Not found in Drive: ${problemFileName}`);
            continue;
        }

        const sanitizedName = sanitizeFilename(file.name);
        const localFilePath = path.join(LOCAL_TARGET, sanitizedName);

        // Check if already exists
        if (fs.existsSync(localFilePath)) {
            console.log(`⏭️ Already exists: ${sanitizedName}`);
            continue;
        }

        try {
            console.log(`⬇️ Downloading: ${file.name}`);
            console.log(`   -> Saving as: ${sanitizedName}`);

            const response = await drive.files.get(
                { fileId: file.id, alt: "media" },
                { responseType: "stream" }
            );

            const writeStream = fs.createWriteStream(localFilePath);
            await pipeline(response.data, writeStream);

            console.log(`✅ Downloaded successfully\n`);
            downloadedCount++;
        } catch (err) {
            console.error(`❌ Error: ${err.message}\n`);
            errorCount++;
        }
    }

    console.log("=".repeat(50));
    console.log("SYNC COMPLETE");
    console.log("=".repeat(50));
    console.log(`✅ Downloaded: ${downloadedCount} files`);
    console.log(`❌ Errors: ${errorCount} files`);

    // Count local files
    const localFiles = fs.readdirSync(LOCAL_TARGET);
    console.log(`\n📁 Local folder now has: ${localFiles.length} files`);
}

syncProblemFiles().catch(console.error);
