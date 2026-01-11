import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function analyze() {
    console.log('Analyzing Supabase Records...');

    // Get all records
    const { data: records, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, status, created_at, vendor, amount');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Total Records: ${records.length}`);

    // Group by file_id
    const byFileId = {};
    records.forEach(r => {
        if (r.file_id) {
            if (!byFileId[r.file_id]) byFileId[r.file_id] = [];
            byFileId[r.file_id].push(r);
        }
    });

    const duplicates = Object.entries(byFileId).filter(([k, v]) => v.length > 1);
    console.log(`Duplicate Sets (by file_id): ${duplicates.length}`);

    if (duplicates.length > 0) {
        console.log('\nSample Duplicates:');
        duplicates.slice(0, 3).forEach(([key, group]) => {
            console.log(`\nFile ID: ${key}`);
            group.forEach(r => {
                console.log(`  [${r.id}] ${r.status} ${r.created_at} ${r.vendor} ${r.amount}`);
            });
        });
    }

    // Group by file_link
    const byLink = {};
    records.forEach(r => {
        if (r.file_link) {
            if (!byLink[r.file_link]) byLink[r.file_link] = [];
            byLink[r.file_link].push(r);
        }
    });

    const linkDuplicates = Object.entries(byLink).filter(([k, v]) => v.length > 1);
    console.log(`\nDuplicate Sets (by file_link): ${linkDuplicates.length}`);

    // Check recent records
    const recent = records.filter(r => {
        const time = new Date(r.created_at).getTime();
        const now = new Date().getTime();
        return (now - time) < 1000 * 60 * 60; // Last 1 hour
    });
    console.log(`\nRecords created in last hour: ${recent.length}`);
    if (recent.length > 0) {
        console.log('Sample recent records:');
        recent.slice(0, 5).forEach(r => console.log(`  [${r.id}] ${r.status} ${r.created_at}`));
    }
}

analyze().catch(console.error);
