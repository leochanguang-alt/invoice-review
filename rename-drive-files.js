import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";

const drive = google.drive({ version: "v3", auth: getDriveAuth() });
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";

// Files with colons that need to be renamed
const FILES_TO_RENAME = [
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

// Sanitize filename (replace colons with underscores)
function sanitizeFilename(name) {
    return name.replace(/:/g, '_');
}

async function renameFilesInDrive() {
    console.log("=== Renaming Files in Google Drive ===\n");
    console.log(`Target folder: ${TEST_INVOICE_FOLDER_ID}\n`);

    // Get all files from the folder
    let allFiles = [];
    let pageToken = null;

    do {
        const res = await drive.files.list({
            q: `'${TEST_INVOICE_FOLDER_ID}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        allFiles.push(...res.data.files);
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    console.log(`Found ${allFiles.length} files in folder\n`);

    let renamedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    for (const oldName of FILES_TO_RENAME) {
        const newName = sanitizeFilename(oldName);

        // Find the file
        const file = allFiles.find(f => f.name === oldName);

        if (!file) {
            console.log(`⚠️ Not found: ${oldName}`);
            notFoundCount++;
            continue;
        }

        try {
            console.log(`📝 Renaming: ${oldName}`);
            console.log(`   -> ${newName}`);

            await drive.files.update({
                fileId: file.id,
                requestBody: {
                    name: newName
                },
                supportsAllDrives: true
            });

            console.log(`✅ Renamed successfully\n`);
            renamedCount++;
        } catch (err) {
            console.error(`❌ Error renaming ${oldName}: ${err.message}\n`);
            errorCount++;
        }
    }

    console.log("=".repeat(50));
    console.log("RENAME COMPLETE");
    console.log("=".repeat(50));
    console.log(`✅ Renamed: ${renamedCount} files`);
    console.log(`⚠️ Not found: ${notFoundCount} files`);
    console.log(`❌ Errors: ${errorCount} files`);
}

renameFilesInDrive().catch(console.error);
