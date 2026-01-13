import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function check() {
    if (!supabase) {
        console.error("Supabase not initialized.");
        return;
    }
    const { data, error } = await supabase
        .from('invoices')
        .select('id, file_link_r2, vendor, invoice_date, status')
        .ilike('file_link_r2', '%Scanned 12 Jan 2026 at 17_48_49.pdf%');
    
    if (error) {
        console.error("Query error:", error);
    } else {
        console.log(`Found ${data.length} records with R2 link but no vendor data.`);
        console.log(JSON.stringify(data, null, 2));
    }
}

check();
