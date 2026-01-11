import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function cleanup() {
    console.log('=== CLEANUP STARTED (Batch 2) ===\n');

    // 1. Verify before delete
    console.log('1. Checking current count...');
    const { count: countBefore } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
    console.log(`   Count before: ${countBefore}`);

    // The boundary ID where duplicates started appearing
    // Based on previous analysis: Records > 8469 are extras.
    // Confirmed extra records count is ~70.
    const MAX_VALID_ID = 8469;

    // 2. Delete extra records
    console.log(`\n2. Deleting records with ID > ${MAX_VALID_ID}...`);

    // We can do this in one go
    const { count: deleteCount, error } = await supabase
        .from('invoices')
        .delete({ count: 'exact' })
        .gt('id', MAX_VALID_ID);

    if (error) {
        console.error('   Error deleting records:', error.message);
        return;
    }

    console.log(`   Deleted ${deleteCount} records.`);

    // 3. Verify after delete
    console.log('\n3. Verifying final count...');
    const { count: countAfter } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
    console.log(`   Count after: ${countAfter}`);

    // 4. Check for any remaining suspicious file_ids
    console.log('\n4. Checking for any remaining duplicate file_ids...');
    const { data: records } = await supabase.from('invoices').select('file_id');
    const seen = new Set();
    let dups = 0;
    records.forEach(r => {
        if (r.file_id) {
            if (seen.has(r.file_id)) dups++;
            seen.add(r.file_id);
        }
    });
    console.log(`   Remaining duplicate file_ids: ${dups}`);
}

cleanup().catch(console.error);
