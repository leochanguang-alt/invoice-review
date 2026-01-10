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

async function deepReconcile() {
    console.log('=== Deep Reconcile "Waiting for Confirm" records ===\n');

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

    console.log('--- Waiting records in Sheet ---');
    const sheetWaiting = [];
    rows.slice(1).forEach((row, i) => {
        if (row[sIdx] === 'Waiting for Confirm') {
            sheetWaiting.push({
                row: i + 2,
                vendor: row[vIdx],
                amount: parseFloat((row[aIdx] || '0').replace(/,/g, '')),
                driveId: row[fIdx]?.trim()
            });
        }
    });

    sheetWaiting.forEach((sw, i) => {
        console.log(`${i + 1}. Row ${sw.row}: ${sw.vendor} | $${sw.amount} | ID: ${sw.driveId}`);
    });

    console.log('\n--- Checking these in Supabase ---');
    for (const sw of sheetWaiting) {
        // Search by driveId
        let match = null;
        if (sw.driveId) {
            const { data } = await supabase.from('invoices').select('id, status, vendor, amount, file_link')
                .ilike('file_link', `%${sw.driveId}%`);
            if (data && data.length > 0) match = data[0];
        }

        if (match) {
            if (match.status === 'Waiting for Confirm') {
                console.log(`Row ${sw.row}: [OK] Found in Supabase ID ${match.id} (Status: Waiting)`);
            } else {
                console.log(`Row ${sw.row}: [STATUS MISMATCH] Found in Supabase ID ${match.id} but Status is "${match.status}"`);
            }
        } else {
            // Try by vendor + amount
            const { data: vMatch } = await supabase.from('invoices').select('id, status, vendor, amount')
                .eq('vendor', sw.vendor)
                .eq('amount', sw.amount);

            if (vMatch && vMatch.length > 0) {
                console.log(`Row ${sw.row}: [POTENTIAL] No File_ID match, but found Vendor/Amount match ID ${vMatch[0].id} (Status: ${vMatch[0].status})`);
            } else {
                console.log(`Row ${sw.row}: [MISSING] Not found in Supabase at all.`);
            }
        }
    }
}

deepReconcile().catch(console.error);
