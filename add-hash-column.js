import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function cleanEnv(v) {
    if (!v) return '';
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    }
    return v;
}

const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
const supabaseKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) || cleanEnv(process.env.SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addFileIdHashColumn() {
    console.log('=== Adding file_ID_HASH column to invoices table ===\n');

    // Try to add the column using raw SQL via RPC
    // Note: This requires the pgSQL extension or a custom RPC function

    // First, let's check if the column already exists by trying to select it
    const { data: testData, error: testError } = await supabase
        .from('invoices')
        .select('file_ID_HASH')
        .limit(1);

    if (!testError) {
        console.log('Column "file_ID_HASH" already exists in the table.');
        return;
    }

    // The column doesn't exist, we need to add it
    // Since Supabase JS client doesn't support DDL directly, 
    // we need to use the SQL editor in Supabase dashboard or use postREST with service role

    console.log('To add the column, please run this SQL in Supabase Dashboard -> SQL Editor:\n');
    console.log('------------------------------------------------------------');
    console.log('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "file_ID_HASH" TEXT;');
    console.log('------------------------------------------------------------');
    console.log('\nOr you can access it at:');
    console.log(`${supabaseUrl.replace('.supabase.co', '.supabase.co')}/project/default/sql/new`);

    console.log('\n\nAlternatively, if you have the service role key, I can try to execute it via RPC...');

    // Try using rpc if available (requires a custom function)
    try {
        const { error: rpcError } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "file_ID_HASH" TEXT;'
        });

        if (rpcError) {
            if (rpcError.message.includes('function') && rpcError.message.includes('does not exist')) {
                console.log('\nNo exec_sql RPC function available. Please use the dashboard method above.');
            } else {
                console.log('\nRPC Error:', rpcError.message);
            }
        } else {
            console.log('\n✅ Column added successfully via RPC!');
        }
    } catch (e) {
        console.log('\nRPC not available. Please use the dashboard method.');
    }
}

addFileIdHashColumn().catch(console.error);
