import 'dotenv/config';
import { google } from "googleapis";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getDriveAuth } from "./api/_sheets.js";

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Recursively list all files in a Google Drive folder
async function listDriveFiles(folderId, prefix = '') {
    const files = [];
    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
        });
        for (const file of res.data.files) {
            if (file.mimeType === "application/vnd.google-apps.folder") {
                const subFiles = await listDriveFiles(file.id, `${prefix}${file.name}/`);
                files.push(...subFiles);
            } else if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push(`${prefix}${file.name}`);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return files;
}

// List all files in R2 under a prefix
async function listR2Files(prefix) {
    const files = [];
    let continuationToken = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        for (const obj of res.Contents || []) {
            // Remove the prefix to get relative path
            files.push(obj.Key.replace(prefix, ''));
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);
    return files;
}

const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3"; // Test_invoice folder
const R2_FR_GOOGLE_DRIVE_PREFIX = "bui_invoice/original_files/fr_google_drive/";

async function compare() {
    console.log("Fetching files from Google Drive Test_invoice folder...");
    const driveFiles = await listDriveFiles(TEST_INVOICE_FOLDER_ID);
    console.log(`Found ${driveFiles.length} files in Google Drive Test_invoice`);

    console.log("\nFetching files from R2 fr_google_drive...");
    const r2Files = await listR2Files(R2_FR_GOOGLE_DRIVE_PREFIX);
    console.log(`Found ${r2Files.length} files in R2 fr_google_drive`);

    // Find files in Drive but not in R2
    const missingInR2 = driveFiles.filter(f => !r2Files.includes(f));
    // Find files in R2 but not in Drive
    const extraInR2 = r2Files.filter(f => !driveFiles.includes(f));

    console.log("\n--- Missing in R2 (should be synced) ---");
    if (missingInR2.length === 0) {
        console.log("None! All Drive files are in R2.");
    } else {
        missingInR2.forEach(f => console.log(`  - ${f}`));
    }

    console.log("\n--- Extra in R2 (not in Drive) ---");
    if (extraInR2.length === 0) {
        console.log("None! R2 matches Drive.");
    } else {
        extraInR2.forEach(f => console.log(`  + ${f}`));
    }

    // Specifically check for the file mentioned by user
    const targetFile = "Receipt from Wolfy's Bar #Bafl.pdf";
    console.log(`\n--- Specific check for "${targetFile}" ---`);
    console.log(`In Drive: ${driveFiles.some(f => f.includes("Wolfy's Bar")) ? 'YES' : 'NO'}`);
    console.log(`In R2: ${r2Files.some(f => f.includes("Wolfy's Bar")) ? 'YES' : 'NO'}`);
}

compare().catch(console.error);
