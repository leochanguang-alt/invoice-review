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

async function fullDiagnosticAndFix() {
    console.log('=== Full Diagnostic and Fix: Sheet to Supabase ===\n');

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:L',
    });

    const rows = res.data.values || [];
    const headers = rows[0];
    const fIdx = headers.indexOf('File_ID');
    const sIdx = headers.indexOf('Status');
    const vIdx = headers.indexOf('Vendor');
    const aIdx = headers.indexOf('amount');

    console.log('Loading Supabase records...');
    const { data: allSupabase } = await supabase.from('invoices').select('id, status, file_link, vendor, amount');
    console.log(`Loaded ${allSupabase.length} records.`);

    let matchedCount = 0;
    let notMatchedCount = 0;
    let mismatchCount = 0;
    let fixedCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const sheetStatus = rows[i][sIdx]?.trim();
        const driveId = rows[i][fIdx]?.trim();
        const vendor = rows[i][vIdx]?.trim();
        const amount = parseFloat((rows[i][aIdx] || '0').replace(/,/g, ''));

        if (!driveId) continue;

        // Try mapping by Drive ID
        let supRecord = allSupabase.find(rec => rec.file_link && rec.file_link.includes(driveId));

        // If not found, try mapping by Vendor + Amount + "Waiting for Confirm"
        if (!supRecord) {
            supRecord = allSupabase.find(rec =>
                rec.vendor === vendor &&
                Math.abs(rec.amount - amount) < 0.01 &&
                rec.status === 'Waiting for Confirm'
            );
        }

        if (supRecord) {
            matchedCount++;
            if (supRecord.status !== sheetStatus && sheetStatus === 'Submitted') {
                mismatchCount++;
                console.log(`[FIXING] Row ${i + 1}: "${vendor}" $${amount} | Sheet: "${sheetStatus}" vs Supabase: "${supRecord.status}" (ID ${supRecord.id})`);

                const { error } = await supabase.from('invoices').update({ status: sheetStatus }).eq('id', supRecord.id);
                if (!error) fixedCount++;
            }
        } else {
            notMatchedCount++;
            // Specifically log records titled "Submitted" but not found
            if (sheetStatus === 'Submitted') {
                // console.log(`[NOT FOUND] Row ${i+1}: "${vendor}" $${amount} is Submitted in Sheet but missing in Supabase mapping`);
            }
        }
    }

    console.log('\n=== Full Sync/Fix Summary ===');
    console.log(`Total rows checked in Sheet: ${rows.length - 1}`);
    console.log(`Matched records: ${matchedCount}`);
    console.log(`Not Matched records: ${notMatchedCount}`);
    console.log(`Mismatched statuses identified: ${mismatchCount}`);
    console.log(`Statuses successfully fixed: ${fixedCount}`);
}

fullDiagnosticAndFix().catch(console.error);
