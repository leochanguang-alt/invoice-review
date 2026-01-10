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

async function reverseDiagnostic() {
    console.log('=== Reverse Diagnostic: Supabase "Waiting for Confirm" -> Sheet ===\n');

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

    console.log('Fetching "Waiting for Confirm" records from Supabase...');
    const { data: waitingRecords } = await supabase.from('invoices')
        .select('id, status, file_link, vendor, amount')
        .eq('status', 'Waiting for Confirm');

    console.log(`Found ${waitingRecords.length} records to check.`);

    let confirmedInSheetCount = 0;

    for (const rec of waitingRecords) {
        // Search for this record in Sheet rows
        const sheetMatch = rows.find(row => {
            const driveId = row[fIdx];
            const vendor = row[vIdx];
            const amount = parseFloat((row[aIdx] || '0').replace(/,/g, ''));

            // Match by DriveId if possible
            if (driveId && rec.file_link && rec.file_link.includes(driveId)) return true;

            // Match by Vendor + Amount
            if (rec.vendor === vendor && Math.abs(rec.amount - amount) < 0.01) return true;

            return false;
        });

        if (sheetMatch) {
            const sheetStatus = sheetMatch[sIdx];
            if (sheetStatus === 'Submitted' || sheetStatus === 'Confirmed') {
                confirmedInSheetCount++;
                console.log(`[FOUND DIFFERENCE] Supabase ID ${rec.id}: "${rec.vendor}" $${rec.amount}`);
                console.log(`   Supabase: "Waiting for Confirm" | Sheet: "${sheetStatus}"`);
            }
        }
    }

    console.log('\n=== Reverse Diagnostic Summary ===');
    console.log(`Checked ${waitingRecords.length} Supabase records.`);
    console.log(`Found ${confirmedInSheetCount} that are Submitted/Confirmed in Sheet.`);
}

reverseDiagnostic().catch(console.error);
