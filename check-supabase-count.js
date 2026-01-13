import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function getCount() {
    if (!supabase) {
        console.error("Supabase not initialized.");
        return;
    }
    const { count, error } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });
    
    if (error) {
        console.error("Query error:", error);
    } else {
        console.log(`Total records in Supabase 'invoices' table: ${count}`);
    }
}

getCount();
