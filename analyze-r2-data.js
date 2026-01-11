import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function analyze() {
    console.log("=== ANALYZING DATA CONSISTENCY ===\n");

    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, file_link_r2, file_ID_HASH_R2, invoice_number');

    if (error) { console.error(error); return; }

    console.log(`Total Records: ${invoices.length}`);

    // 1. Check Duplicates
    const idCounts = {};
    const linkCounts = {};
    const r2HashCounts = {};

    invoices.forEach(inv => {
        if (inv.file_id) idCounts[inv.file_id] = (idCounts[inv.file_id] || 0) + 1;
        if (inv.file_link) linkCounts[inv.file_link] = (linkCounts[inv.file_link] || 0) + 1;
    });

    const duplicateIds = Object.entries(idCounts).filter(e => e[1] > 1);
    const duplicateLinks = Object.entries(linkCounts).filter(e => e[1] > 1);

    console.log(`\n1. Duplicates:`);
    console.log(`   - Duplicate file_id: ${duplicateIds.length}`);
    if (duplicateIds.length > 0) {
        console.log(`     Examples: ${duplicateIds.slice(0, 3).map(e => `${e[0]} (${e[1]})`).join(', ')}`);
    }
    console.log(`   - Duplicate file_link: ${duplicateLinks.length}`);
    if (duplicateLinks.length > 0) {
        console.log(`     Examples: ${duplicateLinks.slice(0, 3).map(e => `${e[0]} (${e[1]})`).join(', ')}`);
    }

    // 2. Check Missing R2 Links
    const missingR2Link = invoices.filter(inv => !inv.file_link_r2);
    console.log(`\n2. Missing file_link_r2: ${missingR2Link.length}`);
    if (missingR2Link.length > 0) {
        console.log(`     Examples IDs: ${missingR2Link.slice(0, 5).map(inv => inv.id).join(', ')}`);
    }

    // 3. Analyze file_ID_HASH_R2 content
    console.log(`\n3. file_ID_HASH_R2 Analysis:`);
    let r2HashEmpty = 0;
    let r2HashDriveId = 0; // Length > 20
    let r2HashETag = 0; // Length <= 35 (MD5 is 32)

    invoices.forEach(inv => {
        const hash = inv.file_ID_HASH_R2;
        if (!hash) {
            r2HashEmpty++;
        } else if (hash.length > 30 && hash.includes('_') || hash.includes('-')) {
            // Drive IDs often have - or _ and are long
            r2HashDriveId++;
            if (r2HashDriveId <= 3) console.log(`     Suspicious Drive ID in R2 Hash (ID: ${inv.id}): ${hash}`);
        } else {
            r2HashETag++;
        }
    });

    console.log(`   - Empty: ${r2HashEmpty}`);
    console.log(`   - Looks like Drive ID (>30 chars): ${r2HashDriveId}`);
    console.log(`   - Looks like ETag/Hash (<=30 chars): ${r2HashETag}`);

}

analyze().catch(console.error);
