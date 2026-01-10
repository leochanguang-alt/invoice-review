import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

async function debugMatching() {
    console.log('=== Debug: R2 vs Supabase Matching ===\n');

    // Get sample R2 files
    console.log('1. Sample R2 files:');
    const res = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'bui_invoice/projects/',
        MaxKeys: 10
    }));

    (res.Contents || []).forEach((obj, i) => {
        console.log(`   ${i + 1}. Key: ${obj.Key}`);
        console.log(`      Filename: ${obj.Key.split('/').pop()}`);
        console.log(`      ETag: ${obj.ETag}`);
    });

    // Get sample Supabase invoices
    console.log('\n2. Sample Supabase invoices:');
    const { data: invoices } = await supabase
        .from('invoices')
        .select('id, file_id, generated_invoice_id, vendor, file_ID_HASH')
        .limit(10);

    invoices.forEach((inv, i) => {
        console.log(`   ${i + 1}. ID: ${inv.id}`);
        console.log(`      file_id: ${inv.file_id}`);
        console.log(`      generated_invoice_id: ${inv.generated_invoice_id}`);
        console.log(`      vendor: ${inv.vendor?.substring(0, 30)}`);
        console.log(`      current hash: ${inv.file_ID_HASH?.substring(0, 20)}...`);
    });

    // Check R2 fr_google_drive folder
    console.log('\n3. Sample fr_google_drive files:');
    const res2 = await r2.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'bui_invoice/original_files/fr_google_drive/',
        MaxKeys: 10
    }));

    (res2.Contents || []).forEach((obj, i) => {
        console.log(`   ${i + 1}. ${obj.Key.split('/').pop()} -> ETag: ${obj.ETag?.replace(/"/g, '')}`);
    });
}

debugMatching().catch(console.error);
