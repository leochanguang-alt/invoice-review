import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import fs from 'fs';

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";

async function list() {
    console.log("Listing R2 Files...");
    const files = [];
    let token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: 'bui_invoice/original_files/fr_google_drive/',
            ContinuationToken: token
        }));
        (res.Contents || []).forEach(o => files.push(o.Key.split('/').pop()));
        token = res.NextContinuationToken;
    } while (token);

    fs.writeFileSync('r2_files_list.txt', files.join('\n'));
    console.log(`Saved ${files.length} filenames to r2_files_list.txt`);
}

list();
