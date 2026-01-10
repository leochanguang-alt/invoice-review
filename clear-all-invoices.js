import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function clearAllInvoices() {
    console.log('=== Clearing ALL records from Supabase invoices table ===\n');

    if (!supabase) {
        console.error('Error: Supabase client not initialized.');
        return;
    }

    // 1. Get current count
    const { count: beforeCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });

    console.log(`Current record count: ${beforeCount}`);

    if (beforeCount === 0) {
        console.log('Table is already empty. Nothing to delete.');
        return;
    }

    // 2. Get all record IDs
    console.log('\nFetching all record IDs...');
    const { data: allRecs, error: fetchErr } = await supabase
        .from('invoices')
        .select('id');

    if (fetchErr) {
        console.error('Error fetching records:', fetchErr.message);
        return;
    }

    const allIds = allRecs.map(r => r.id);
    console.log(`Found ${allIds.length} records to delete.`);

    // 3. Delete in chunks of 100 to avoid timeout
    console.log('\nDeleting records in chunks...');
    const chunkSize = 100;
    let deletedCount = 0;

    for (let i = 0; i < allIds.length; i += chunkSize) {
        const chunk = allIds.slice(i, i + chunkSize);
        const { error: delErr } = await supabase
            .from('invoices')
            .delete()
            .in('id', chunk);

        if (delErr) {
            console.error(`Error deleting chunk ${i / chunkSize + 1}:`, delErr.message);
        } else {
            deletedCount += chunk.length;
            console.log(`Deleted ${deletedCount}/${allIds.length} records...`);
        }
    }

    // 4. Verify deletion
    const { count: afterCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });

    console.log(`\n✅ Done! Records before: ${beforeCount}, Records after: ${afterCount}`);
}

clearAllInvoices().catch(console.error);
