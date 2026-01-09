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

async function listDriveFiles(folderId, prefix = "") {
    let files = [];
    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
        });

        for (const file of res.data.files) {
            const path = prefix ? `${prefix}/${file.name}` : file.name;
            if (file.mimeType === "application/vnd.google-apps.folder") {
                const subFiles = await listDriveFiles(file.id, path);
                files = files.concat(subFiles);
            } else {
                files.push(path);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return files;
}

async function listR2Objects(prefix) {
    let objects = [];
    let continuationToken = null;
    do {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        });
        const res = await r2.send(command);
        if (res.Contents) {
            objects = objects.concat(res.Contents.map(o => o.Key));
        }
        continuationToken = res.NextContinuationToken;
    } while (continuationToken);
    return objects;
}

async function verify() {
    const DRIVE_FOLDER_ID = "14cHbyYH-wZSHfFHS-5aY-x7zw2bip2lD";
    const R2_PREFIX = "bui_invoice";

    console.log("Fetching Drive file list...");
    const driveFiles = await listDriveFiles(DRIVE_FOLDER_ID, R2_PREFIX);

    console.log("Fetching R2 object list...");
    const r2Objects = await listR2Objects(R2_PREFIX);

    console.log(`\nResults:`);
    console.log(`Drive Files (Total): ${driveFiles.length}`);

    const driveDuplicates = driveFiles.filter((item, index) => driveFiles.indexOf(item) !== index);
    console.log(`Drive Files (Unique): ${driveFiles.length - driveDuplicates.length}`);
    if (driveDuplicates.length > 0) {
        console.log(`Drive Duplicates (${driveDuplicates.length}):`);
        new Set(driveDuplicates).forEach(d => console.log(` - ${d}`));
    }

    console.log(`R2 Objects Count: ${r2Objects.length}`);

    const driveSet = new Set(driveFiles);
    const r2Set = new Set(r2Objects);

    const missingInR2 = driveFiles.filter(f => !r2Set.has(f));
    const extraInR2 = r2Objects.filter(o => !driveSet.has(o));

    if (missingInR2.length > 0) {
        const uniqueMissing = [...new Set(missingInR2)];
        console.log(`\nMissing in R2 (Unique: ${uniqueMissing.length}):`);
        uniqueMissing.slice(0, 10).forEach(f => console.log(` - ${f}`));
        if (uniqueMissing.length > 10) console.log("   ...");
    } else {
        console.log("\nAll Drive files are present in R2!");
    }

    if (extraInR2.length > 0) {
        console.log(`\nExtra in R2 (${extraInR2.length}):`);
        extraInR2.slice(0, 10).forEach(o => console.log(` - ${o}`));
        if (extraInR2.length > 10) console.log("   ...");
    }
}

verify().catch(console.error);
