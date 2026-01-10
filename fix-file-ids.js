import 'dotenv/config';
import crypto from 'crypto';
import { supabase } from './api/_supabase.js';

async function analyzeAndFixData() {
    console.log('=== Analyzing Supabase Data ===\n');

    // 1. Get all invoice data
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, status, vendor, amount, generated_invoice_id');

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log(`Total invoices: ${invoices.length}\n`);

    // 2. Analyze status distribution
    const statusCounts = {};
    for (const inv of invoices) {
        const status = inv.status || '(empty)';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    console.log('Status distribution:');
    for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${status}: ${count}`);
    }

    // 3. Analyze file_id formats
    console.log('\nFile ID format analysis:');
    let hashIdCount = 0;
    let googleDriveIdCount = 0;
    let r2KeyCount = 0;
    let emptyCount = 0;
    let otherCount = 0;

    const nonHashIds = [];

    for (const inv of invoices) {
        const id = inv.file_id || '';
        if (!id) {
            emptyCount++;
        } else if (id.length === 12 && /^[a-f0-9]+$/.test(id)) {
            hashIdCount++;
        } else if (id.includes('/')) {
            r2KeyCount++;
            nonHashIds.push({ id: inv.id, file_id: id, file_link: inv.file_link });
        } else if (id.length > 20) {
            googleDriveIdCount++;
            nonHashIds.push({ id: inv.id, file_id: id, file_link: inv.file_link });
        } else {
            otherCount++;
            nonHashIds.push({ id: inv.id, file_id: id, file_link: inv.file_link });
        }
    }

    console.log(`  Hash IDs (12 char hex): ${hashIdCount}`);
    console.log(`  Google Drive IDs: ${googleDriveIdCount}`);
    console.log(`  R2 Keys (with /): ${r2KeyCount}`);
    console.log(`  Empty: ${emptyCount}`);
    console.log(`  Other: ${otherCount}`);

    // 4. Show examples of non-hash IDs
    console.log('\nExamples of non-hash file_ids:');
    for (const item of nonHashIds.slice(0, 5)) {
        console.log(`  ID ${item.id}: ${item.file_id?.substring(0, 40)}...`);
        if (item.file_link) {
            console.log(`    file_link: ${item.file_link.substring(0, 60)}...`);
        }
    }

    console.log(`\nTotal records needing file_id update: ${nonHashIds.length}`);

    // 5. Preview what the update would look like
    console.log('\n--- PREVIEW: File ID conversions ---');
    for (const item of nonHashIds.slice(0, 3)) {
        // Generate hash from file_link or file_id
        const source = item.file_link || item.file_id || '';
        const newHash = crypto.createHash('md5').update(source).digest('hex').substring(0, 12);
        console.log(`  ${item.id}: ${item.file_id?.substring(0, 30)}... -> ${newHash}`);
    }

    return { invoices, nonHashIds };
}

async function updateFileIds(dryRun = true) {
    const { invoices, nonHashIds } = await analyzeAndFixData();

    if (!nonHashIds || nonHashIds.length === 0) {
        console.log('\nNo file_ids need updating.');
        return;
    }

    if (dryRun) {
        console.log(`\n[DRY RUN] Would update ${nonHashIds.length} records.`);
        console.log('Run with --apply to actually update.');
        return;
    }

    console.log(`\nUpdating ${nonHashIds.length} file_ids...`);
    let updated = 0;
    let errors = 0;

    for (const item of nonHashIds) {
        // Generate hash from file_link (preferred) or file_id
        const source = item.file_link || item.file_id || `record-${item.id}`;
        const newHash = crypto.createHash('md5').update(source).digest('hex').substring(0, 12);

        const { error } = await supabase
            .from('invoices')
            .update({ file_id: newHash })
            .eq('id', item.id);

        if (error) {
            console.error(`  Error updating ${item.id}: ${error.message}`);
            errors++;
        } else {
            updated++;
        }
    }

    console.log(`\nUpdate complete: ${updated} updated, ${errors} errors`);
}

const applyMode = process.argv.includes('--apply');
updateFileIds(!applyMode).catch(console.error);
