import 'dotenv/config';
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { supabase } from './api/_supabase.js';

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

async function testProxy() {
    console.log("Fetching a sample record from Supabase...");
    const { data, error } = await supabase
        .from('invoices')
        .select('file_link')
        .eq('status', 'Waiting for Confirm')
        .not('file_link', 'is', null)
        .limit(1);

    if (error) {
        console.error("Supabase error:", error);
        return;
    }

    if (!data || data.length === 0) {
        console.log("No records found with file_link.");
        return;
    }

    const fileLink = data[0].file_link;
    console.log("Testing file_link:", fileLink);

    let r2Key;
    if (fileLink.includes('.r2.cloudflarestorage.com/')) {
        r2Key = fileLink.split('.r2.cloudflarestorage.com/')[1];
    } else if (fileLink.startsWith('bui_invoice/')) {
        r2Key = fileLink;
    }

    if (!r2Key) {
        console.error("Could not determine R2 key from link.");
        return;
    }

    console.log("Extracted R2 key:", r2Key);

    try {
        console.log("Sending HeadObjectCommand to R2...");
        const headRes = await r2.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: r2Key,
        }));
        console.log("HeadObject success. ContentType:", headRes.ContentType);

        console.log("Sending GetObjectCommand to R2...");
        const getRes = await r2.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: r2Key,
        }));
        console.log("GetObject success. ContentLength:", headRes.ContentLength);

        console.log("ALL TESTS PASSED.");
    } catch (err) {
        console.error("R2 Proxy Test FAILED:");
        console.error("Error Name:", err.name);
        console.error("Error Message:", err.message);
        if (err.$metadata) {
            console.error("HTTP Status Code:", err.$metadata.httpStatusCode);
        }
    }
}

testProxy();
