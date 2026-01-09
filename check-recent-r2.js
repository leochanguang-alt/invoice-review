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

async function checkRecent() {
    const prefix = "bui_invoice/original_files/fr_google_drive/";
    console.log(`Checking recent uploads in: ${prefix}`);

    const res = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
    }));

    if (!res.Contents) {
        console.log("No files found in that path.");
        return;
    }

    const now = new Date();
    const recent = res.Contents.filter(o => (now - new Date(o.LastModified)) < 3600000); // last 1 hour

    console.log(`\nFound ${recent.length} files uploaded in the last hour:`);
    recent.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    recent.forEach(o => {
        console.log(` - ${o.Key} (Modified: ${o.LastModified})`);
    });
}

checkRecent().catch(console.error);
