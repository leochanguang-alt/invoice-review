import 'dotenv/config';
import { google } from 'googleapis';
import crypto from 'crypto';
import { supabase } from './api/_supabase.js';

function cleanEnv(v) {
    if (!v) return '';
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    }
    return v;
}

const CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);
const SHEET_ID = cleanEnv(process.env.SHEET_ID);

async function fullMirror() {
    console.log('=== Full Mirror Sync: Complete Field Mapping ===\n');

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Fetch Sheet Data
    console.log('Fetching Google Sheet data...');
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:R', // 18 columns
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = res.data.values || [];
    const headers = rows[0];

    // Exact mapping based on Sheet header inspection
    // 0: File_ID, 1: Invoice_data, 2: Vendor, 3: amount, 4: currency
    // 5: invoice_number, 6: Location(City), 7: Country, 8: Category, 9: file_link
    // 10: Status, 11: Charge to Company, 12: Charge to Project, 13: Owner
    // 14: Invoice_ID, 15: Amount (HKD), 16: Achieved_File_ID, 17: Achieved_File_link

    console.log(`Sheet has ${rows.length - 1} records.`);

    // 2. Clear ALL existing records in Supabase
    console.log('Clearing ALL existing records in Supabase...');

    // Fetch all IDs first
    const { data: allRecs } = await supabase.from('invoices').select('id');
    if (allRecs && allRecs.length > 0) {
        const ids = allRecs.map(r => r.id);
        // Delete in chunks
        for (let i = 0; i < ids.length; i += 100) {
            const chunk = ids.slice(i, i + 100);
            await supabase.from('invoices').delete().in('id', chunk);
        }
        console.log(`Deleted ${allRecs.length} existing records.`);
    }

    // Verify deletion
    const { count: afterClear } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
    console.log(`After clear: ${afterClear} records remain.`);

    // 3. Prepare full data for insertion
    console.log('Preparing data with ALL fields...');
    const toInsert = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveId = row[0]?.trim(); // File_ID
        if (!driveId) continue;

        // Generate unique hash including row index for duplicates
        const source = `https://drive.google.com/file/d/${driveId}/view?usp=drivesdk`;
        const hash = crypto.createHash('md5').update(source + i).digest('hex').substring(0, 12);

        // Parse amount safely
        const amountStr = (row[3] || '0').toString().replace(/,/g, '');
        const amount = parseFloat(amountStr) || 0;

        // Parse amount_hkd safely
        const amountHkdStr = (row[15] || '0').toString().replace(/,/g, '');
        const amountHkd = parseFloat(amountHkdStr) || null;

        toInsert.push({
            file_id: hash,
            invoice_date: row[1] || null,                    // Invoice_data
            vendor: row[2] || null,                          // Vendor
            amount: amount,                                   // amount
            currency: row[4] || null,                        // currency
            invoice_number: row[5] || null,                  // invoice_number
            location_city: row[6] || null,                   // Location(City)
            country: row[7] || null,                         // Country
            category: row[8] || null,                        // Category
            file_link: row[9] || `https://drive.google.com/uc?id=${driveId}&export=download`, // file_link
            status: row[10]?.trim() || 'Waiting for Confirm', // Status
            charge_to_company: row[11] || null,              // Charge to Company
            charge_to_project: row[12] || null,              // Charge to Project
            owner_name: row[13] || null,                     // Owner
            generated_invoice_id: (row[14] === 'null' || !row[14]) ? null : row[14], // Invoice_ID
            amount_hkd: amountHkd,                           // Amount (HKD)
            archived_file_id: row[16] || null,               // Achieved_File_ID
            archived_file_link: row[17] || null              // Achieved_File_link
        });
    }

    console.log(`Prepared ${toInsert.length} records with full field mapping.`);

    // 4. Batch Insert
    const chunkSize = 50;
    let insertedCount = 0;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from('invoices').insert(chunk);
        if (insErr) {
            console.error(`Insert error at chunk ${i}:`, insErr.message);
        } else {
            insertedCount += chunk.length;
        }
    }

    console.log(`\n=== Mirror Complete ===`);
    console.log(`Inserted: ${insertedCount} records`);

    // Final verification
    const { count: finalCount } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
    console.log(`Final Supabase Count: ${finalCount}`);

    // Status Distribution
    const { data: stats } = await supabase.from('invoices').select('status');
    const dist = {};
    stats.forEach(s => dist[s.status] = (dist[s.status] || 0) + 1);
    console.log('Status Distribution:', JSON.stringify(dist, null, 2));

    // Verify a sample record has all fields
    const { data: sample } = await supabase.from('invoices').select('*').limit(1);
    console.log('\nSample record (verify all fields):');
    console.log(JSON.stringify(sample[0], null, 2));
}

fullMirror().catch(console.error);
