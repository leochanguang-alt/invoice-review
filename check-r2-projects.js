import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";

async function checkProjects() {
    console.log("Checking R2 projects folder...");
    const files = [];
    let token;

    // We want to list everything under bui_invoice/projects/
    // Since we don't know the exact project codes, we'll list recursively
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: 'bui_invoice/projects/',
            ContinuationToken: token
        }));

        (res.Contents || []).forEach(o => {
            // Filter out placeholder files
            if (!o.Key.endsWith('.placeholder')) {
                files.push({
                    key: o.Key,
                    lastModified: o.LastModified,
                    size: o.Size
                });
            }
        });
        token = res.NextContinuationToken;
    } while (token);

    // Sort by LastModified descending
    files.sort((a, b) => b.lastModified - a.lastModified);

    console.log(`Found ${files.length} project files.`);
    console.log("Top 15 most recently modified files:");
    files.slice(0, 15).forEach(f => {
        console.log(`[${f.lastModified.toISOString()}] ${f.key} (${f.size} bytes)`);
    });
}

checkProjects().catch(console.error);
