import 'dotenv/config';
import { google } from 'googleapis';
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

async function findMissing() {
    console.log('=== Finding Missing Records: Sheet -> Supabase ===\n');

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:L',
    });

    const rows = res.data.values || [];
    const headers = rows[0].map(h => (h || '').trim());
    const fIdx = headers.indexOf('File_ID');
    const vIdx = headers.indexOf('Vendor');
    const aIdx = headers.indexOf('amount');
    const sIdx = headers.indexOf('Status');

    console.log('Fetching all Supabase records...');
    const { data: allSupabase } = await supabase.from('invoices').select('id, file_link, vendor, amount, status');
    console.log(`Supabase has ${allSupabase.length} records.`);

    console.log('\n--- Checking for duplicates in Sheet (File_ID) ---');
    const seenFileIds = new Map(); // driveId -> list of rowNums
    rows.slice(1).forEach((row, i) => {
        const id = row[fIdx]?.trim();
        if (!id) return;
        if (!seenFileIds.has(id)) seenFileIds.set(id, []);
        seenFileIds.get(id).push(i + 2);
    });

    let duplicatesFound = 0;
    for (const [id, rowNums] of seenFileIds.entries()) {
        if (rowNums.length > 1) {
            console.log(`Duplicate File_ID: ${id} found in rows: ${rowNums.join(', ')}`);
            duplicatesFound++;
        }
    }
    console.log(`Total duplicate File_IDs: ${duplicatesFound}`);

    console.log('\n--- Checking for records IN Sheet but NOT in Supabase ---');
    let missingCount = 0;
    rows.slice(1).forEach((row, i) => {
        const driveId = row[fIdx]?.trim();
        const vendor = row[vIdx];
        const status = row[sIdx];

        if (!driveId) {
            console.log(`Row ${i + 2}: Missing File_ID | ${vendor} | Status: ${status}`);
            missingCount++;
            return;
        }

        const match = allSupabase.find(rec => rec.file_link && rec.file_link.includes(driveId));
        if (!match) {
            console.log(`Row ${i + 2}: Missing in Supabase | ${vendor} | ID: ${driveId} | Status: ${status}`);
            missingCount++;
        }
    });

    console.log(`\nTotal Missing: ${missingCount}`);
}

findMissing().catch(console.error);
