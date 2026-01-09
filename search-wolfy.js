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

async function searchDrive() {
    console.log("=== Searching Google Drive for 'Wolfy' files ===");
    const res = await drive.files.list({
        q: "name contains 'Wolfy' and trashed = false",
        fields: "files(id, name, parents)",
    });
    res.data.files.forEach(f => console.log(`  ${f.name} (parent: ${f.parents})`));
    return res.data.files;
}

async function searchR2() {
    console.log("\n=== Searching R2 for 'Wolfy' files ===");
    const res = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: "bui_invoice/",
    }));
    const wolfyFiles = (res.Contents || []).filter(obj => obj.Key.includes("Wolfy"));
    wolfyFiles.forEach(f => console.log(`  ${f.Key}`));
    return wolfyFiles;
}

async function main() {
    const driveFiles = await searchDrive();
    const r2Files = await searchR2();

    console.log("\n=== Summary ===");
    console.log(`Drive 'Wolfy' files: ${driveFiles.length}`);
    console.log(`R2 'Wolfy' files: ${r2Files.length}`);

    // Check specifically for #Bafl
    const baflInDrive = driveFiles.filter(f => f.name.includes('#Bafl'));
    const baflInR2 = r2Files.filter(f => f.Key.includes('#Bafl') || f.Key.includes('%23Bafl'));
    console.log(`\nDrive files with '#Bafl': ${baflInDrive.length}`);
    baflInDrive.forEach(f => console.log(`  ${f.name}`));
    console.log(`R2 files with '#Bafl': ${baflInR2.length}`);
    baflInR2.forEach(f => console.log(`  ${f.Key}`));
}

main().catch(console.error);
