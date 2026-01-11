import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

async function investigate() {
    console.log('=== INVESTIGATION STARTED ===\n');

    // 1. Supabase Status Breakdown
    console.log('1. Supabase Status Partition:');
    const { data: allRecords } = await supabase.from('invoices').select('id, status, created_at, file_id, file_link');

    const statusCounts = {};
    const createdByHour = {};

    allRecords.forEach(r => {
        // Status counts
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

        // Creation time analysis (by hour)
        const date = new Date(r.created_at);
        const key = date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
        createdByHour[key] = (createdByHour[key] || 0) + 1;
    });

    console.table(statusCounts);
    console.log('\nCreation Timeline (hourly):');
    console.table(createdByHour);

    // 2. Identify potential duplicates
    console.log('\n2. Duplicate Check:');
    const fileIdCounts = {};
    const linkCounts = {};
    let dupFileIds = 0;
    let dupLinks = 0;

    allRecords.forEach(r => {
        if (r.file_id) {
            fileIdCounts[r.file_id] = (fileIdCounts[r.file_id] || 0) + 1;
            if (fileIdCounts[r.file_id] === 2) dupFileIds++;
        }
        if (r.file_link) {
            linkCounts[r.file_link] = (linkCounts[r.file_link] || 0) + 1;
            if (linkCounts[r.file_link] === 2) dupLinks++;
        }
    });

    console.log(`- Duplicate file_ids: ${dupFileIds}`);
    console.log(`- Duplicate file_links: ${dupLinks}`);

    if (dupFileIds > 0) {
        console.log('  Sample duplicate file_ids:');
        const dups = Object.entries(fileIdCounts).filter(([k, v]) => v > 1).slice(0, 5);
        console.log(dups);
    }

    // 3. R2 File Counts
    console.log('\n3. R2 File Counts:');

    const countR2 = async (prefix) => {
        let count = 0;
        let token;
        do {
            const res = await r2.send(new ListObjectsV2Command({
                Bucket: process.env.R2_BUCKET_NAME,
                Prefix: prefix,
                ContinuationToken: token
            }));
            count += (res.Contents || []).length;
            token = res.NextContinuationToken;
        } while (token);
        return count;
    };

    const frCount = await countR2('bui_invoice/original_files/fr_google_drive/');
    const prCount = await countR2('bui_invoice/projects/');

    console.log(`- fr_google_drive: ${frCount}`);
    console.log(`- projects: ${prCount}`);

    // 4. Sample Recent Records
    console.log('\n4. Latest 5 Records:');
    const recent = allRecords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    recent.forEach(r => console.log(`[${r.id}] ${r.status} (${r.created_at}) - ${r.file_id}`));

}

investigate().catch(console.error);
