import 'dotenv/config';
import { google } from 'googleapis';

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

function getRecordKey(driveId, vendor, amount) {
    const v = (vendor || '').trim().toLowerCase();
    const a = parseFloat((amount || '0').toString().replace(/,/g, '')).toFixed(2);
    return `${driveId}|${v}|${a}`;
}

async function checkUniqueness() {
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

    const keys = new Map();
    rows.slice(1).forEach((row, idx) => {
        const driveId = row[mapping.file_id]?.trim();
        if (!driveId) return;
        const key = getRecordKey(driveId, row[mapping.vendor], row[mapping.amount]);
        if (!keys.has(key)) keys.set(key, []);
        keys.get(key).push(idx + 2);
    });

    console.log('--- Duplicate Keys in Sheet ---');
    let dups = 0;
    for (const [key, rowNums] of keys.entries()) {
        if (rowNums.length > 1) {
            console.log(`Key: ${key} found in rows: ${rowNums.join(', ')}`);
            dups++;
        }
    }
    console.log(`Total duplicate keys: ${dups}`);
    console.log(`Unique keys: ${keys.size}`);
}

checkUniqueness().catch(console.error);
