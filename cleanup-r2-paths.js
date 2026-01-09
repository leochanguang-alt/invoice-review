import 'dotenv/config';
import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// Source: wrong path created by old GitHub Action
const SOURCE_PREFIX = "bui_invoice/original_files/n8n_Test/Test_invoice/";
// Target: correct path
const TARGET_PREFIX = "bui_invoice/original_files/fr_google_drive/";

async function cleanup() {
    console.log(`Moving files from:\n  ${SOURCE_PREFIX}\nTo:\n  ${TARGET_PREFIX}\n`);

    let continuationToken = null;
    let movedCount = 0;
    let skippedCount = 0;

    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: SOURCE_PREFIX,
            ContinuationToken: continuationToken,
        }));

        for (const obj of res.Contents || []) {
            const oldKey = obj.Key;
            const fileName = oldKey.replace(SOURCE_PREFIX, '');
            const newKey = TARGET_PREFIX + fileName;

            try {
                // Copy to new location
                await r2.send(new CopyObjectCommand({
                    Bucket: BUCKET_NAME,
                    CopySource: encodeURIComponent(`${BUCKET_NAME}/${oldKey}`),
                    Key: newKey,
                }));

                // Delete from old location
                await r2.send(new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: oldKey,
                }));

                console.log(`Moved: ${fileName}`);
                movedCount++;
            } catch (err) {
                console.error(`Error moving ${fileName}:`, err.message);
                skippedCount++;
            }
        }

        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);

    console.log(`\n=== Cleanup Complete ===`);
    console.log(`Moved: ${movedCount} files`);
    console.log(`Skipped/Errors: ${skippedCount} files`);
}

cleanup().catch(console.error);
