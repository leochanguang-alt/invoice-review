const { google } = require('googleapis');
const dotenv = require('dotenv');
const path = require('path');

// Load .env.local
dotenv.config({ path: path.join(__dirname, '.env.local') });

function cleanEnv(v) {
    if (!v) return "";
    v = v.trim();
    // Remove surrounding quotes
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    // Remove literal \n sequences at the end
    v = v.replace(/\\n$/, '');
    return v;
}

const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const rawKey = process.env.GOOGLE_PRIVATE_KEY;
const rawSheetId = process.env.SHEET_ID;

const email = cleanEnv(rawEmail);
const sheetId = cleanEnv(rawSheetId);
let key = cleanEnv(rawKey);
key = key.replace(/\\n/g, '\n');

console.log('--- DEBUG INFO ---');
console.log('Email length:', email.length);
console.log('Email (masked):', email.substring(0, 5) + '...' + email.substring(email.length - 10));
console.log('Sheet ID length:', sheetId.length);
console.log('Sheet ID (masked):', sheetId.substring(0, 5) + '...' + sheetId.substring(sheetId.length - 5));
console.log('Key length:', key.length);
console.log('Key starts with:', key.substring(0, 30));
console.log('Key ends with:', key.substring(key.length - 30).replace(/\n/g, '\\n'));
console.log('------------------');

async function test() {
    try {
        const auth = new google.auth.JWT({
            email,
            key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        console.log('Attempting to get access token...');
        const token = await auth.getAccessToken();
        console.log('SUCCESS! Access token retrieved.');

        const sheets = google.sheets({ version: 'v4', auth });
        console.log(`Attempting to read Sheet ID: ${sheetId}`);
        const res = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
        });
        console.log('SUCCESS! Spreadsheet title:', res.data.properties.title);
    } catch (e) {
        console.error('FAILED!');
        console.error('Error Name:', e.name);
        console.error('Error Message:', e.message);
        if (e.response && e.response.data) {
            console.error('API Error Data:', JSON.stringify(e.response.data, null, 2));
        }
    }
}

test();
