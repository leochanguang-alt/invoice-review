import 'dotenv/config';
import { google } from 'googleapis';

function cleanEnv(v) {
    if (!v) return '';
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    return v;
}

const email = cleanEnv(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
let key = cleanEnv(process.env.GOOGLE_PRIVATE_KEY);
key = key.replace(/\\n/g, '\n');
const SHEET_ID = cleanEnv(process.env.SHEET_ID);

const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function main() {
    const res = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
    });
    console.log('Sheets in spreadsheet:');
    res.data.sheets.forEach(s => {
        console.log(`- "${s.properties.title}"`);
    });
}

main().catch(console.error);
