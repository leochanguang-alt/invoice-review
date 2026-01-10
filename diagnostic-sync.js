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

async function diagnostic() {
    console.log('=== Diagnostic: Matching Sheet to Supabase ===\n');

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

    console.log('Checking records that are "Submitted" in Sheet...');

    let matchedCount = 0;
    let mismatchCount = 0;
    let totalChecked = 0;

    for (let i = 1; i < rows.length; i++) {
        const sheetStatus = rows[i][sIdx];
        if (sheetStatus === 'Submitted' || sheetStatus === 'Confirmed') {
            totalChecked++;
            const driveId = rows[i][fIdx];
            const vendor = rows[i][vIdx];
            const amount = rows[i][aIdx];

            // Strategy 1: Search by file_link ilike driveId
            const { data: byLink } = await supabase.from('invoices').select('id, status, file_link').ilike('file_link', `%${driveId}%`);

            if (byLink && byLink.length > 0) {
                const supRecord = byLink[0];
                if (supRecord.status !== sheetStatus) {
                    console.log(`[MISMATCH] Row ${i + 1}: ${vendor} ${amount}`);
                    console.log(`   Sheet: "${sheetStatus}" vs Supabase: "${supRecord.status}" (ID ${supRecord.id})`);
                    mismatchCount++;
                } else {
                    matchedCount++;
                }
            } else {
                // Strategy 2: Search by vendor + amount
                const { data: byVendor } = await supabase.from('invoices')
                    .select('id, status, file_link')
                    .eq('vendor', vendor)
                    .eq('status', 'Waiting for Confirm'); // Specifically look for candidates

                if (byVendor && byVendor.length > 0) {
                    // console.log(`[POTENTIAL] Row ${i+1} (${vendor}) could be Supabase ID ${byVendor[0].id}`);
                }
            }
        }

        if (totalChecked >= 50) break; // Check first 50 submitted ones
    }

    console.log('\nResults (first 50):');
    console.log(`Total Checked: ${totalChecked}`);
    console.log(`Matched (Correct Status): ${matchedCount}`);
    console.log(`Matched (Mismatch Status): ${mismatchCount}`);
    console.log(`Not Found: ${totalChecked - matchedCount - mismatchCount}`);
}

diagnostic().catch(console.error);
