import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function checkCount() {
    const { count, error } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Error fetching count:', error);
    } else {
        console.log(`Total records in Supabase 'invoices' table: ${count}`);
    }
}

checkCount();
