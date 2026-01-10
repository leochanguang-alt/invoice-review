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

function extractDriveId(link) {
    if (!link) return null;
    const match = link.match(/[-\w]{25,}/);
    return match ? match[0] : null;
}

function getRecordKey(driveId, vendor, amount) {
    const v = (vendor || '').trim().toLowerCase();
    const a = parseFloat((amount || '0').toString().replace(/,/g, '')).toFixed(2);
    return `${driveId}|${v}|${a}`;
}

async function reconcile() {
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
    const mapping = {
        file_id: headers.indexOf('File_ID'),
        vendor: headers.indexOf('Vendor'),
        amount: headers.indexOf('amount')
    };

    const { data: allSupabase } = await supabase.from('invoices').select('*');
    const supKeys = new Set(allSupabase.map(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        return getRecordKey(dId, rec.vendor, rec.amount);
    }));

    console.log('--- Missing Rows ---');
    let missingCount = 0;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveId = row[mapping.file_id]?.trim();
        if (!driveId) {
            console.log(`Row ${i + 1}: NO File_ID | ${row[mapping.vendor]} | ${row[mapping.amount]}`);
            missingCount++;
            continue;
        }
        const key = getRecordKey(driveId, row[mapping.vendor], row[mapping.amount]);
        if (!supKeys.has(key)) {
            console.log(`Row ${i + 1}: MISSING | ${row[mapping.vendor]} | ${row[mapping.amount]} | ID: ${driveId}`);
            missingCount++;
        }
    }
    console.log(`\nTotal Missing: ${missingCount}`);
}

reconcile().catch(console.error);
