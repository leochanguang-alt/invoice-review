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

async function inspectWaiting() {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:L',
    });

    const rows = res.data.values || [];
    const headers = rows[0];
    const sIdx = headers.indexOf('Status');
    const fIdx = headers.indexOf('File_ID');
    const vIdx = headers.indexOf('Vendor');
    const aIdx = headers.indexOf('amount');

    console.log(`Analyzing ${rows.length - 1} rows from Sheet...`);
    console.log('--- "Waiting for Confirm" records in Sheet ---');

    let count = 0;
    rows.slice(1).forEach((row, i) => {
        if (row[sIdx] === 'Waiting for Confirm') {
            count++;
            console.log(`${count}. Row ${i + 2}: ${row[vIdx]} | $${row[aIdx]} | File_ID: ${row[fIdx] || '[EMPTY]'}`);
        }
    });
    console.log(`\nTotal "Waiting for Confirm" in Sheet: ${count}`);
}

inspectWaiting().catch(console.error);
