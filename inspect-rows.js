import 'dotenv/config';
import fs from 'fs';
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

async function inspect() {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // Header + rows around 120
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:Z',
    });

    const rows = res.data.values;
    const headers = rows[0];
    const sIdx = headers.indexOf('Status');

    console.log('--- Final Audit ---');
    console.log('Total Rows (including header):', rows.length);
    console.log('Records in Sheet:', rows.length - 1);

    let waitingCount = 0;
    rows.slice(1).forEach(r => {
        if (r[sIdx]?.trim() === 'Waiting for Confirm') waitingCount++;
    });
    console.log('Waiting for Confirm in Sheet:', waitingCount);

    const data = {
        totalRows: rows.length,
        waitingCount,
        columnMapping: headers.map((h, i) => `${i}: ${h}`),
        row120: rows[119],
        row121: rows[120]
    };
    fs.writeFileSync('final_audit.json', JSON.stringify(data, null, 2));
    console.log('Audit data saved to final_audit.json');
}

inspect().catch(console.error);
