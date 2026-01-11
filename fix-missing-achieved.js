import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { S3Client, CopyObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";
const R2_PROJECTS_PREFIX = "bui_invoice/projects";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${BUCKET_NAME}.r2.cloudflarestorage.com`;

async function fixMissingAchieved() {
    console.log("=== Fixing Missing Achieved Files ===\n");

    // 1. Find submitted records missing achieved fields
    const { data: records, error } = await supabase
        .from('invoices')
        .select('id, generated_invoice_id, charge_to_project, file_link_r2, file_link')
        .eq('status', 'Submitted')
        .is('achieved_file_id', null);

    if (error) { console.error("DB Error:", error); return; }
    console.log(`Found ${records.length} records to fix.`);

    for (const rec of records) {
        const { id, generated_invoice_id, charge_to_project, file_link_r2, file_link } = rec;
        console.log(`\n[${id}] Invoice: ${generated_invoice_id}`);

        // Get source R2 key from file_link_r2 (or file_link)
        const sourceLink = file_link_r2 || file_link || "";
        const keyMatch = sourceLink.match(/bui_invoice\/.*$/);

        if (!keyMatch) {
            console.log(`   SKIP: No valid R2 source link found. Link: "${sourceLink}"`);
            continue;
        }

        const originalKey = keyMatch[0];
        const parts = originalKey.split('.');
        const fileExtension = parts.length > 1 ? '.' + parts[parts.length - 1] : '.pdf';

        // Target path
        const targetKey = `${R2_PROJECTS_PREFIX}/${charge_to_project}/${generated_invoice_id}${fileExtension}`;

        try {
            console.log(`   Copying: ${originalKey} -> ${targetKey}`);

            // URL encode the source key to handle special characters (#, spaces, Chinese, etc.)
            const encodedSource = `${BUCKET_NAME}/${originalKey.split('/').map(p => encodeURIComponent(p)).join('/')}`;

            await r2.send(new CopyObjectCommand({
                Bucket: BUCKET_NAME,
                CopySource: encodedSource,
                Key: targetKey
            }));

            const archivedLink = `${R2_PUBLIC_URL}/${targetKey}`;

            // Update DB
            const { error: upErr } = await supabase
                .from('invoices')
                .update({
                    achieved_file_id: targetKey,
                    achieved_file_link: archivedLink
                })
                .eq('id', id);

            if (upErr) {
                console.log(`   DB Update FAILED:`, upErr.message);
            } else {
                console.log(`   SUCCESS: ${archivedLink}`);
            }

        } catch (copyErr) {
            console.error(`   COPY FAILED:`, copyErr.message);
        }
    }

    console.log("\nDone.");
}

fixMissingAchieved().catch(console.error);
