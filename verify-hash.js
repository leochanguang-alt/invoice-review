import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function verifyHash() {
    const { data, error } = await supabase
        .from('invoices')
        .select('file_id, file_ID_HASH')
        .limit(5);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log('Sample records with file_ID_HASH:\n');
    data.forEach((r, i) => {
        console.log(`${i + 1}. file_id: ${r.file_id?.substring(0, 30)}...`);
        console.log(`   file_ID_HASH: ${r.file_ID_HASH}`);
    });

    // Count records with hash
    const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('file_ID_HASH', 'is', null);

    console.log(`\n✅ Records with file_ID_HASH: ${count}`);
}

verifyHash().catch(console.error);
