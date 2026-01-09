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

async function cleanup() {
    const INCORRECT_PATH = "bui_invoice/original_files/n8n_Test/";
    console.log(`Cleaning up misplaced files from: ${INCORRECT_PATH}`);

    let continuationToken = null;
    do {
        const listRes = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: INCORRECT_PATH,
            ContinuationToken: continuationToken,
        }));

        if (!listRes.Contents) break;

        for (const obj of listRes.Contents) {
            const oldKey = obj.Key;
            let newKey;

            if (oldKey.includes("/Test_invoice/")) {
                newKey = oldKey.replace(INCORRECT_PATH + "Test_invoice/", "bui_invoice/original_files/fr_google_drive/");
            } else {
                newKey = oldKey.replace(INCORRECT_PATH, "bui_invoice/original_files/");
            }

            console.log(`Relocating: ${oldKey} -> ${newKey}`);

            const encodedKey = oldKey.split('/').map(encodeURIComponent).join('/');
            await r2.send(new CopyObjectCommand({
                Bucket: BUCKET_NAME,
                CopySource: `${BUCKET_NAME}/${encodedKey}`,
                Key: newKey,
            }));

            await r2.send(new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: oldKey,
            }));
        }

        continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);

    console.log("Cleanup complete!");
}

cleanup().catch(console.error);
