import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function testUpdate() {
    console.log("Testing update on 8055...");

    // 1. Fetch current
    const { data: current, error: fetchErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', 8055)
        .single();

    if (fetchErr) {
        console.error("Fetch Error:", fetchErr);
        return;
    }
    console.log("Current file_link_r2:", current.file_link_r2);

    // 2. Update
    const { data, error } = await supabase
        .from('invoices')
        .update({ file_link_r2: 'https://test-link.com/foo.pdf' })
        .eq('id', 8055)
        .select();

    if (error) {
        console.error("Update Error:", error);
    } else {
        console.log("Update Success! Data:", data);
    }
}

testUpdate();
