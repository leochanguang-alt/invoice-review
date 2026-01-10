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

async function finalAudit() {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:Z',
        valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = res.data.values || [];
    const headers = rows[0].map(h => (h || '').trim());
    const sIdx = headers.indexOf('Status');
    const vIdx = headers.indexOf('Vendor');
    const aIdx = headers.indexOf('amount');

    console.log('--- Waiting Records in SHEET ---');
    const sheetW = rows.slice(1).filter(r => r[sIdx]?.trim() === 'Waiting for Confirm')
        .map(r => `${r[vIdx]} | ${r[aIdx]}`);
    sheetW.sort().forEach((s, i) => console.log(`${i + 1}. ${s}`));

    console.log('\n--- Waiting Records in SUPABASE ---');
    const { data: supaRecs } = await supabase.from('invoices').select('vendor, amount').eq('status', 'Waiting for Confirm');
    const supaW = supaRecs.map(r => `${r.vendor} | ${r.amount}`);
    supaW.sort().forEach((s, i) => console.log(`${i + 1}. ${s}`));
}

finalAudit().catch(console.error);
