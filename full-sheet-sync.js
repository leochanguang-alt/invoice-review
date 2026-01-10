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

async function fullSync() {
    console.log('=== Full Sync: Google Sheet -> Supabase ===\n');

    // Check Supabase connection
    if (!supabase) {
        console.error('Error: Supabase client not initialized.');
        return;
    }

    // Setup OAuth2 (Read-only operation)
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Fetch Sheet Data
    console.log('1. Fetching Google Sheet data...');
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:R',  // All 18 columns
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
        console.log('No data rows found in sheet.');
        return;
    }

    const headers = rows[0].map(h => (h || '').trim());
    console.log(`   Headers: ${headers.join(', ')}`);
    console.log(`   Total rows: ${rows.length - 1}`);

    // Build column index mapping
    const colIdx = {};
    headers.forEach((h, i) => colIdx[h] = i);

    // 2. Clear existing Supabase records
    console.log('\n2. Clearing existing Supabase records...');
    const { data: existingRecs } = await supabase.from('invoices').select('id');
    if (existingRecs && existingRecs.length > 0) {
        const allIds = existingRecs.map(r => r.id);
        const chunkSize = 100;
        for (let i = 0; i < allIds.length; i += chunkSize) {
            await supabase.from('invoices').delete().in('id', allIds.slice(i, i + chunkSize));
        }
        console.log(`   Deleted ${allIds.length} existing records`);
    } else {
        console.log('   No existing records to delete');
    }

    // 3. Transform and prepare records
    console.log('\n3. Transforming data...');
    const toInsert = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Use Achieved_File_ID if available, otherwise fall back to File_ID
        const achievedFileId = row[colIdx['Achieved_File_ID']]?.trim();
        const fileId = row[colIdx['File_ID']]?.trim();
        const driveId = achievedFileId || fileId;

        if (!driveId) {
            console.log(`   Row ${i + 1}: Skipping - no file ID`);
            continue;
        }

        // Parse amount
        let amount = 0;
        const amountStr = row[colIdx['amount']] || '0';
        amount = parseFloat(amountStr.toString().replace(/,/g, '')) || 0;

        // Parse Amount (HKD)
        let amountHKD = null;
        const amountHKDStr = row[colIdx['Amount (HKD)']];
        if (amountHKDStr) {
            amountHKD = parseFloat(amountHKDStr.toString().replace(/,/g, '')) || null;
        }

        // Build file_link from Achieved_File_link or construct from drive ID
        const achievedFileLink = row[colIdx['Achieved_File_link']]?.trim();
        const fileLink = achievedFileLink || `https://drive.google.com/uc?id=${driveId}&export=download`;

        // Generate file_ID_HASH from the drive ID
        const fileIdHash = crypto.createHash('md5').update(driveId).digest('hex');

        const record = {
            file_id: driveId,
            "file_ID_HASH": fileIdHash,
            file_link: fileLink,
            achieved_file_id: row[colIdx['Achieved_File_ID']]?.trim() || null,
            achieved_file_link: achievedFileLink || null,
            vendor: row[colIdx['Vendor']]?.trim() || null,
            amount: amount,
            currency: row[colIdx['currency']]?.trim() || null,
            invoice_date: row[colIdx['Invoice_data']]?.trim() || null,
            invoice_number: row[colIdx['invoice_number']]?.trim() || null,
            location_city: row[colIdx['Location(City)']]?.trim() || null,
            country: row[colIdx['Country']]?.trim() || null,
            category: row[colIdx['Category']]?.trim() || null,
            status: row[colIdx['Status']]?.trim() || 'Waiting for Confirm',
            charge_to_company: row[colIdx['Charge to Company']]?.trim() || null,
            charge_to_project: row[colIdx['Charge to Project']]?.trim() || null,
            owner_name: row[colIdx['Owner']]?.trim() || null,
            generated_invoice_id: row[colIdx['Invoice_ID']]?.trim() || null,
            amount_hkd: amountHKD
        };

        // Clean up null-like strings
        if (record.generated_invoice_id === 'null') record.generated_invoice_id = null;

        toInsert.push(record);
    }

    console.log(`   Prepared ${toInsert.length} records for insert`);

    // 4. Batch insert
    console.log('\n4. Inserting into Supabase...');
    const chunkSize = 50;
    let insertedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from('invoices').insert(chunk);
        if (insErr) {
            console.error(`   Error at chunk ${Math.floor(i / chunkSize) + 1}: ${insErr.message}`);
            errorCount += chunk.length;
        } else {
            insertedCount += chunk.length;
            console.log(`   Inserted ${insertedCount}/${toInsert.length} records...`);
        }
    }

    // 5. Verify final count
    console.log('\n5. Verifying...');
    const { count: finalCount } = await supabase.from('invoices').select('*', { count: 'exact', head: true });

    // Get status distribution
    const { data: statusData } = await supabase.from('invoices').select('status');
    const dist = {};
    statusData?.forEach(s => dist[s.status] = (dist[s.status] || 0) + 1);

    console.log('\n' + '='.repeat(50));
    console.log('SYNC COMPLETE');
    console.log('='.repeat(50));
    console.log(`\nGoogle Sheet rows: ${rows.length - 1}`);
    console.log(`Supabase records: ${finalCount}`);
    console.log(`Successfully inserted: ${insertedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log('\nStatus Distribution:');
    Object.keys(dist).sort().forEach(status => {
        console.log(`  ${status}: ${dist[status]}`);
    });
}

fullSync().catch(console.error);
