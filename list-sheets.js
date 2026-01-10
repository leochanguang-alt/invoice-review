import 'dotenv/config';
import { google } from 'googleapis';

function cleanEnv(v) {
    if (!v) return "";
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    return v;
}

const CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);
const SHEET_ID = cleanEnv(process.env.SHEET_ID);

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Error: OAuth2 credentials missing in .env');
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

async function main() {
    try {
        const res = await sheets.spreadsheets.get({
            spreadsheetId: SHEET_ID,
        });
        console.log('Sheets in spreadsheet:');
        res.data.sheets.forEach(s => {
            console.log(`- "${s.properties.title}"`);
        });
    } catch (err) {
        console.error('Error getting spreadsheet:', err.message);
        if (err.response && err.response.data) {
            console.error('Details:', JSON.stringify(err.response.data, null, 2));
        }
    }
}

main().catch(console.error);
