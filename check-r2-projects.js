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

async function listR2Prefix(prefix) {
    console.log(`\nListing R2 prefix: ${prefix}`);

    const res = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: 50
    }));

    // List directories (CommonPrefixes)
    if (res.CommonPrefixes && res.CommonPrefixes.length > 0) {
        console.log(`\nSubdirectories:`);
        for (const p of res.CommonPrefixes) {
            const name = p.Prefix.replace(prefix, '').replace(/\/$/, '');
            console.log(`  📁 ${name}`);
        }
    }

    // List files (Contents)
    if (res.Contents && res.Contents.length > 0) {
        console.log(`\nFiles (first 10):`);
        res.Contents.slice(0, 10).forEach(f => {
            const name = f.Key.split('/').pop();
            console.log(`  📄 ${name}`);
        });
        if (res.Contents.length > 10) {
            console.log(`  ... and ${res.Contents.length - 10} more files`);
        }
    }
}

async function main() {
    console.log('=== Checking R2 Structure for Projects ===');

    // Check if there's a projects folder
    await listR2Prefix('bui_invoice/');
    await listR2Prefix('bui_invoice/projects/');
    await listR2Prefix('bui_invoice/archived/');
}

main().catch(console.error);
