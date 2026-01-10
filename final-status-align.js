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

async function finalAlign() {
    console.log('=== Final Status Alignment: Supabase <-> Google Sheets ===\n');

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Fetch Sheet data
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

    // 2. Fetch "Waiting for Confirm" records from Supabase
    const { data: waitingRecords } = await supabase.from('invoices')
        .select('id, status, file_link, vendor, amount')
        .eq('status', 'Waiting for Confirm');

    console.log(`Checking ${waitingRecords.length} records in Supabase that are "Waiting for Confirm"...`);

    let fixedCount = 0;

    for (const rec of waitingRecords) {
        // Search in Sheet
        const sheetMatch = rows.find(row => {
            const driveId = row[fIdx]?.trim();
            const vendor = row[vIdx]?.trim();
            const amount = parseFloat((row[aIdx] || '0').replace(/,/g, ''));

            if (driveId && rec.file_link && rec.file_link.includes(driveId)) return true;
            if (rec.vendor === vendor && Math.abs(rec.amount - amount) < 0.01) return true;
            return false;
        });

        if (sheetMatch) {
            const sheetStatus = sheetMatch[sIdx];
            if (sheetStatus === 'Submitted' || sheetStatus === 'Confirmed') {
                console.log(`Fixing Supabase ID ${rec.id}: Status -> "${sheetStatus}"`);

                const { error } = await supabase.from('invoices')
                    .update({ status: sheetStatus })
                    .eq('id', rec.id);

                if (!error) fixedCount++;
                else console.error(`Error fixing ID ${rec.id}:`, error.message);
            }
        }
    }

    console.log('\n=== Alignment Complete ===');
    console.log(`Successfully fixed ${fixedCount} records in Supabase.`);

    // Final check on counts
    const { data: finalCounts } = await supabase.from('invoices').select('status');
    const summary = {};
    finalCounts.forEach(r => summary[r.status] = (summary[r.status] || 0) + 1);
    console.log('\nFinal Status Distribution in Supabase:');
    console.log(JSON.stringify(summary, null, 2));
}

finalAlign().catch(console.error);
