import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";

async function fixHashes() {
    const idsToFix = [9777, 9778];
    console.log(`Checking records: ${idsToFix.join(', ')}`);

    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*')
        .in('id', idsToFix);

    if (error) {
        console.error("DB Error:", error);
        return;
    }

    for (const inv of invoices) {
        if (inv.file_ID_HASH) {
            console.log(`Record ${inv.id} already has hash: ${inv.file_ID_HASH}`);
            continue;
        }

        if (!inv.file_link) {
            console.log(`Record ${inv.id} has no file_link, skipping.`);
            continue;
        }

        // Extract Key from file_link
        // file_link format assumption: https://.../key
        // But better to search for known prefix 'bui_invoice/'
        const match = inv.file_link.match(/(bui_invoice\/.*)/);
        if (!match) {
            console.log(`Record ${inv.id}: Could not extract R2 key from ${inv.file_link}`);
            continue;
        }

        // Decode URI components in case filenames have spaces/special chars
        const key = decodeURIComponent(match[1]);
        console.log(`Record ${inv.id}: Checking R2 Key: ${key}`);

        try {
            const head = await r2.send(new HeadObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key
            }));

            const etag = head.ETag?.replace(/['"]/g, ''); // Remove quotes
            console.log(`   Found ETag: ${etag}`);

            if (etag) {
                const { error: updateErr } = await supabase
                    .from('invoices')
                    .update({ file_ID_HASH: etag })
                    .eq('id', inv.id);

                if (updateErr) console.error(`   Update failed: ${updateErr.message}`);
                else console.log(`   Updated Supabase successfully.`);
            }

        } catch (e) {
            console.error(`   R2 Error for ${key}:`, e.message);
        }
    }
}

fixHashes().catch(console.error);
