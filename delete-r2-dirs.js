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

async function deletePrefix(prefix) {
    console.log(`\nDeleting all files under: ${prefix}`);
    let continuationToken = null;
    let deletedCount = 0;

    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));

        for (const obj of res.Contents || []) {
            try {
                await r2.send(new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: obj.Key,
                }));
                deletedCount++;
                if (deletedCount % 50 === 0) {
                    console.log(`  Deleted ${deletedCount} files...`);
                }
            } catch (err) {
                console.error(`Error deleting ${obj.Key}:`, err.message);
            }
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);

    console.log(`  Total deleted from ${prefix}: ${deletedCount} files`);
    return deletedCount;
}

async function main() {
    console.log("=== Cleaning up R2 structure ===");

    // Delete projects/
    const projectsDeleted = await deletePrefix("bui_invoice/original_files/projects/");

    // Delete n8n_Test/
    const n8nTestDeleted = await deletePrefix("bui_invoice/original_files/n8n_Test/");

    console.log("\n=== Cleanup Complete ===");
    console.log(`Total files deleted: ${projectsDeleted + n8nTestDeleted}`);
}

main().catch(console.error);
