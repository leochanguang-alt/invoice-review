import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function testAPIs() {
    console.log('=== Testing Migrated APIs ===\n');

    // Test 1: Check Supabase connection
    console.log('1. Testing Supabase connection...');
    const { count, error: countErr } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });

    if (countErr) {
        console.error('   ❌ Supabase connection failed:', countErr.message);
        return;
    }
    console.log(`   ✅ Supabase connected. Invoice count: ${count}`);

    // Test 2: Test manage API - get projects
    console.log('\n2. Testing projects read from Supabase...');
    const { data: projects, error: projErr } = await supabase
        .from('projects')
        .select('project_code, project_name')
        .limit(5);

    if (projErr) {
        console.error('   ❌ Projects query failed:', projErr.message);
    } else {
        console.log(`   ✅ Found ${projects.length} projects`);
        projects.forEach(p => console.log(`      - ${p.project_code}: ${p.project_name}`));
    }

    // Test 3: Check a sample invoice with file_id and file_link
    console.log('\n3. Testing invoice data with file info...');
    const { data: sampleInvoice, error: invErr } = await supabase
        .from('invoices')
        .select('id, vendor, amount, status, file_id, file_link, generated_invoice_id')
        .not('file_id', 'is', null)
        .limit(1)
        .single();

    if (invErr) {
        console.error('   ❌ Invoice query failed:', invErr.message);
    } else {
        console.log('   ✅ Sample invoice:');
        console.log(`      ID: ${sampleInvoice.id}`);
        console.log(`      Vendor: ${sampleInvoice.vendor}`);
        console.log(`      Amount: ${sampleInvoice.amount}`);
        console.log(`      Status: ${sampleInvoice.status}`);
        console.log(`      file_id: ${sampleInvoice.file_id || '(empty)'}`);
        console.log(`      file_link: ${sampleInvoice.file_link ? sampleInvoice.file_link.substring(0, 50) + '...' : '(empty)'}`);
        console.log(`      Invoice ID: ${sampleInvoice.generated_invoice_id || '(not submitted)'}`);
    }

    // Test 4: Check owner list
    console.log('\n4. Testing owners read from Supabase...');
    const { data: owners, error: ownErr } = await supabase
        .from('owners')
        .select('owner_id, owner_name')
        .limit(5);

    if (ownErr) {
        console.error('   ❌ Owners query failed:', ownErr.message);
    } else {
        console.log(`   ✅ Found ${owners.length} owners`);
    }

    // Test 5: Check companies
    console.log('\n5. Testing companies read from Supabase...');
    const { data: companies, error: compErr } = await supabase
        .from('companies')
        .select('company_id, company_name')
        .limit(5);

    if (compErr) {
        console.error('   ❌ Companies query failed:', compErr.message);
    } else {
        console.log(`   ✅ Found ${companies.length} companies`);
        companies.forEach(c => console.log(`      - ${c.company_id}: ${c.company_name}`));
    }

    console.log('\n=== API Migration Tests Complete ===');
}

testAPIs().catch(console.error);
