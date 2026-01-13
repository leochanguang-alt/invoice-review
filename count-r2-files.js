import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PREFIX = 'bui_invoice/original_files/fr_google_drive/';

async function countR2() {
    let total = 0;
    let continuationToken = null;
    try {
        do {
            const command = new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: R2_PREFIX,
                ContinuationToken: continuationToken,
            });
            const response = await r2.send(command);
            total += response.Contents ? response.Contents.length : 0;
            continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
        } while (continuationToken);
        console.log(`Total files in R2 prefix '${R2_PREFIX}': ${total}`);
    } catch (err) {
        console.error(err);
    }
}

countR2();
