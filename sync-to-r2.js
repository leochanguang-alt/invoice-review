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
            let nextR2Prefix;

            // Special Mapping Logic for Root Folders
            if (r2Prefix === "bui_invoice/original_files") {
                if (file.name === "Test_invoice") {
                    nextR2Prefix = `${r2Prefix}/fr_google_drive`;
                } else {
                    nextR2Prefix = `${r2Prefix}/${file.name}`;
                }
            } else {
                nextR2Prefix = `${r2Prefix}/${file.name}`;
            }

            if (file.mimeType === "application/vnd.google-apps.folder") {
                await syncFolderToR2(file.id, nextR2Prefix);
            } else {
                const r2Key = nextR2Prefix; // For files, nextR2Prefix is the full key

                try {
                    // 1. Check if exists (Incremental Sync)
                    try {
                        await r2.send(new HeadObjectCommand({
                            Bucket: BUCKET_NAME,
                            Key: r2Key,
                        }));
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

const DRIVE_FOLDER_ID = "14cHbyYH-wZSHfFHS-5aY-x7zw2bip2lD";
const R2_ROOT_PREFIX = "bui_invoice/original_files";

console.log(`Starting automated sync...`);
console.log(`Drive Root: ${DRIVE_FOLDER_ID}`);
console.log(`R2 Root: ${BUCKET_NAME}/${R2_ROOT_PREFIX}`);

syncFolderToR2(DRIVE_FOLDER_ID, R2_ROOT_PREFIX)
    .then(() => console.log("Sync complete!"))
    .catch((err) => console.error("Sync failed:", err));
