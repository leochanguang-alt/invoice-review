import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function test() {
    console.log('Testing Supabase connection and data retrieval...\n');

    if (!supabase) {
        console.error('ERROR: Supabase client not initialized');
        return;
    }

    const { data, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, vendor, amount, status')
        .limit(5);

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('Sample records from Supabase:');
        console.log('-----------------------------');
        data.forEach((item, i) => {
            console.log(`Record ${i + 1}:`);
            console.log(`  ID: ${item.id}`);
            console.log(`  file_id: ${item.file_id || '(empty)'}`);
            console.log(`  file_link: ${item.file_link ? item.file_link.substring(0, 50) + '...' : '(empty)'}`);
            console.log(`  vendor: ${item.vendor}`);
            console.log(`  amount: ${item.amount}`);
            console.log(`  status: ${item.status}`);
            console.log('');
        });
        console.log(`Total sample shown: ${data.length} records`);
    }
}

test();
