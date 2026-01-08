import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function debugId(targetId) {
    console.log(`Searching for file_id: "${targetId}"`);

    // 1. Direct match
    const { data: direct, error: e1 } = await supabase
        .from('invoices')
        .select('*')
        .eq('file_id', targetId);

    console.log('Direct match result:', JSON.stringify(direct, null, 2));

    // 2. Like match (case insensitive or with wildcards)
    const { data: like, error: e2 } = await supabase
        .from('invoices')
        .select('file_id, id')
        .ilike('file_id', `%${targetId}%`);

    console.log('ILike match result:', JSON.stringify(like, null, 2));

    if (like && like.length > 0) {
        console.log('Lengths of found IDs:', like.map(r => r.file_id?.length));
    }
}

const target = '16ZKLUFohnK1uP1G_oz-22EC21nCvdDx_';
debugId(target);
