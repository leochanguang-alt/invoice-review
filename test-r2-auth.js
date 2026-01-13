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

async function testR2() {
    console.log("Testing Cloudflare R2 connectivity...");
    console.log("Endpoint:", process.env.R2_ENDPOINT ? "PRESENT" : "MISSING");
    console.log("Bucket:", BUCKET_NAME ? BUCKET_NAME : "MISSING");

    if (!process.env.R2_ENDPOINT || !BUCKET_NAME) {
        console.error("Missing R2 configuration.");
        return;
    }

    try {
        console.log("Attempting to list objects in bucket:", BUCKET_NAME);
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            MaxKeys: 5,
        });
        const response = await r2.send(command);
        console.log("R2 connectivity: SUCCESS.");
        console.log("Found", response.Contents ? response.Contents.length : 0, "objects (up to 5 displayed):");
        if (response.Contents) {
            response.Contents.forEach(obj => {
                console.log(` - ${obj.Key} (${obj.Size} bytes)`);
            });
        }
        console.log("ALL R2 AUTH TESTS PASSED.");
    } catch (err) {
        console.error("R2 AUTH TEST FAILED:");
        console.error(err.name, ":", err.message);
    }
}

testR2();
