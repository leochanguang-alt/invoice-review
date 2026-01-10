import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { supabase } from './api/_supabase.js';

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

async function findUnmatched() {
    // Get R2 fr_google_drive ETags
    const r2Files = [];
    let token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: 'bui_invoice/original_files/fr_google_drive/',
            ContinuationToken: token
        }));
        for (const f of res.Contents || []) {
            r2Files.push(f.ETag?.replace(/"/g, ''));
        }
        token = res.IsTruncated ? res.NextContinuationToken : null;
    } while (token);

    const r2Etags = new Set(r2Files);
    console.log('R2 files:', r2Files.length);

    // Get Submitted records with file_ID_HASH
    const { data } = await supabase
        .from('invoices')
        .select('id, file_id, file_ID_HASH, generated_invoice_id, vendor, charge_to_project')
        .eq('status', 'Submitted');

    console.log('Submitted records:', data.length);

    // Find unmatched
    const unmatched = data.filter(d => !r2Etags.has(d.file_ID_HASH));
    console.log('\nUnmatched records:', unmatched.length);

    unmatched.forEach(u => {
        console.log('\n--- Unmatched Record ---');
        console.log('ID:', u.id);
        console.log('Invoice:', u.generated_invoice_id);
        console.log('Vendor:', u.vendor);
        console.log('Project:', u.charge_to_project);
        console.log('file_ID_HASH:', u.file_ID_HASH);
        console.log('file_id:', u.file_id);
    });
}

findUnmatched().catch(console.error);
