import 'dotenv/config';
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { getDriveAuth } from "./api/_sheets.js";

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_");
}

async function downloadFolder(folderId, localDirPath) {
    if (!fs.existsSync(localDirPath)) {
        fs.mkdirSync(localDirPath, { recursive: true });
    }

    console.log(`Scanning folder: ${folderId} -> ${localDirPath}`);

    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
        });

        for (const file of res.data.files) {
            const sanitizedName = sanitizeFilename(file.name);
            const localPath = path.join(localDirPath, sanitizedName);

            if (file.mimeType === "application/vnd.google-apps.folder") {
                await downloadFolder(file.id, localPath);
            } else {
                console.log(`Downloading file: ${file.name} -> ${localPath}`);
                if (fs.existsSync(localPath)) {
                    console.log(`File already exists, skipping: ${sanitizedName}`);
                    continue;
                }
                const dest = fs.createWriteStream(localPath);

                try {
                    const response = await drive.files.get(
                        { fileId: file.id, alt: "media" },
                        { responseType: "stream" }
                    );

                    await new Promise((resolve, reject) => {
                        response.data
                            .on("error", reject)
                            .pipe(dest)
                            .on("finish", resolve)
                            .on("error", reject);
                    });
                } catch (err) {
                    console.error(`Error downloading file ${file.name}:`, err.message);
                    // For Google Docs/Sheets, we might need to export them, but assuming these are raw files (PDFs/Images)
                    if (err.message.includes("Only files with binary content can be downloaded")) {
                        console.warn(`Skipping Google Doc file (not binary): ${file.name}`);
                    }
                }
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
}

const DRIVE_FOLDER_ID = "14cHbyYH-wZSHfFHS-5aY-x7zw2bip2lD";
const LOCAL_TARGET_DIR = path.resolve("bui_invoice");

console.log(`Starting sync from Drive Folder ${DRIVE_FOLDER_ID} to ${LOCAL_TARGET_DIR}...`);

downloadFolder(DRIVE_FOLDER_ID, LOCAL_TARGET_DIR)
    .then(() => console.log("Sync complete!"))
    .catch((err) => console.error("Sync failed:", err));
