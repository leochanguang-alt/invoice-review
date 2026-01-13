import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function checkCount() {
    if (!supabase) return;
    const { count, error } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .ilike('file_link_r2', '%/fr_google_drive/%');
    
    if (error) console.error(error);
    else console.log(`Records in Supabase with 'fr_google_drive' in link: ${count}`);
}

checkCount();
