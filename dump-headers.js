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

const SHEET_MAP = {
    company: "Company_info",
    projects: "Projects",
    owner: "Invoice_Owner",
    main: "Main",
    currency_history: "C_Rate"
};

async function main() {
    for (const [k, v] of Object.entries(SHEET_MAP)) {
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `${v}!1:1`,
            });
            console.log(`${k} headers:`, JSON.stringify(res.data.values?.[0] || []));
        } catch (e) {
            console.error(`${k} error:`, e.message);
        }
    }
}

main().catch(console.error);
