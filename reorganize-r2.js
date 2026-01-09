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

async function reorganize() {
    const OLD_PREFIX = "bui_invoice/n8n_Test/";
    const NEW_ROOT = "bui_invoice/original_files/";
    const OLD_SUB = "bui_invoice/n8n_Test/Test_invoice/";
    const NEW_SUB = "bui_invoice/original_files/fr_google_drive/";

    console.log(`Mapping prefixes:`);
    console.log(`  ${OLD_SUB} -> ${NEW_SUB}`);
    console.log(`  ${OLD_PREFIX} -> ${NEW_ROOT}`);

    let continuationToken = null;
    let count = 0;

    do {
        const listCommand = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: OLD_PREFIX,
            ContinuationToken: continuationToken,
        });

        const listRes = await r2.send(listCommand);
        if (!listRes.Contents) break;

        for (const obj of listRes.Contents) {
            const oldKey = obj.Key;
            let newKey;

            if (oldKey.startsWith(OLD_SUB)) {
                newKey = oldKey.replace(OLD_SUB, NEW_SUB);
            } else {
                newKey = oldKey.replace(OLD_PREFIX, NEW_ROOT);
            }

            if (oldKey === newKey) continue;

            console.log(`Moving: ${oldKey} -> ${newKey}`);

            try {
                // Construct CopySource with proper encoding for each part
                const encodedKey = oldKey.split('/').map(encodeURIComponent).join('/');
                const copySource = `${BUCKET_NAME}/${encodedKey}`;

                // 1. Copy
                await r2.send(new CopyObjectCommand({
                    Bucket: BUCKET_NAME,
                    CopySource: copySource,
                    Key: newKey,
                }));

                // 2. Delete
                await r2.send(new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: oldKey,
                }));

                count++;
            } catch (err) {
                console.error(`Failed to move ${oldKey}:`, err.message);
                if (err.name === 'NoSuchKey') {
                    console.log(`Skipping - may have already been moved.`);
                }
            }
        }

        continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);

    console.log(`\nReorganization complete! Moved ${count} objects.`);
}

reorganize().catch(console.error);
