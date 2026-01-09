import 'dotenv/config';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

async function listAllInPrefix(prefix) {
    const files = [];
    let continuationToken = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));
        for (const obj of res.Contents || []) {
            files.push(obj.Key);
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);
    return files;
}

async function main() {
    console.log("=== Analyzing R2 bui_invoice/original_files structure ===\n");

    // List top-level directories
    const allFiles = await listAllInPrefix("bui_invoice/original_files/");

    const structure = {};
    for (const key of allFiles) {
        const relativePath = key.replace("bui_invoice/original_files/", "");
        const topDir = relativePath.split("/")[0];
        if (!structure[topDir]) structure[topDir] = 0;
        structure[topDir]++;
    }

    console.log("Top-level directories under bui_invoice/original_files/:");
    for (const [dir, count] of Object.entries(structure)) {
        console.log(`  ${dir}: ${count} files`);
    }

    console.log("\n=== Files to DELETE (projects/ and n8n_Test/) ===");

    const projectsFiles = await listAllInPrefix("bui_invoice/original_files/projects/");
    const n8nTestFiles = await listAllInPrefix("bui_invoice/original_files/n8n_Test/");

    console.log(`projects/: ${projectsFiles.length} files`);
    console.log(`n8n_Test/: ${n8nTestFiles.length} files`);

    console.log("\n=== Files to KEEP (fr_google_drive/) ===");
    const frGoogleDriveFiles = await listAllInPrefix("bui_invoice/original_files/fr_google_drive/");
    console.log(`fr_google_drive/: ${frGoogleDriveFiles.length} files`);
}

main().catch(console.error);
