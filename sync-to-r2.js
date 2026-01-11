import 'dotenv/config';
import { google } from "googleapis";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
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

function sanitizeName(name) {
    if (!name) return "";
    return name.replace(/[\\\/:*?"<>|]/g, '_').trim();
}

async function syncFolderToR2(folderId, r2Prefix) {
    console.log(`Scanning Drive folder: ${folderId} -> R2: ${r2Prefix}`);

    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
        });

        for (const file of res.data.files) {
            const safeName = sanitizeName(file.name);
            const nextR2Prefix = `${r2Prefix}/${safeName}`;

            if (file.mimeType.startsWith('application/vnd.google-apps.')) {
                if (file.mimeType === "application/vnd.google-apps.folder") {
                    // Recurse into subfolders
                    await syncFolderToR2(file.id, nextR2Prefix);
                }
                // Skip Google Docs, Sheets, etc. (non-downloadable)
            } else {
                const r2Key = nextR2Prefix;

                try {
                    // Check if file already exists in R2
                    try {
                        await r2.send(new HeadObjectCommand({
                            Bucket: BUCKET_NAME,
                            Key: r2Key,
                        }));
                        // File exists, skip
                        console.log(`Skipping existing: ${r2Key}`);
                        continue;
                    } catch (err) {
                        if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
                            throw err;
                        }
                    }

                    console.log(`Syncing NEW: ${file.name} -> ${r2Key}`);

                    const response = await drive.files.get(
                        { fileId: file.id, alt: "media" },
                        { responseType: "stream" }
                    );

                    const upload = new Upload({
                        client: r2,
                        params: {
                            Bucket: BUCKET_NAME,
                            Key: r2Key,
                            Body: response.data,
                            ContentType: file.mimeType,
                        },
                    });

                    await upload.done();
                    console.log(`Successfully uploaded: ${file.name}`);
                } catch (err) {
                    console.error(`Error syncing ${file.name}:`, err.message);
                }
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
}

// ONLY sync Test_invoice folder (inside n8n_Test) to fr_google_drive
// Google Drive: n8n_Test/Test_invoice -> R2: bui_invoice/original_files/fr_google_drive
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";
const R2_TARGET_PREFIX = "bui_invoice/original_files/fr_google_drive";

console.log(`Starting sync: Google Drive Test_invoice -> R2 ${R2_TARGET_PREFIX}`);
console.log(`Drive Folder ID: ${TEST_INVOICE_FOLDER_ID}`);

syncFolderToR2(TEST_INVOICE_FOLDER_ID, R2_TARGET_PREFIX)
    .then(() => console.log("Sync complete!"))
    .catch((err) => console.error("Sync failed:", err));
