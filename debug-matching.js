import 'dotenv/config';
import { google } from 'googleapis';
import crypto from 'crypto';

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

async function debugMatching() {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:L',
    });

    const rows = res.data.values || [];
    const headers = rows[0];
    const fileIdIdx = headers.indexOf('File_ID');
    const vendorIdx = headers.indexOf('Vendor');

    console.log('Searching for "Nut Farms" or ID 1hdnfKjDwe...');

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveId = row[fileIdIdx];
        const vendor = row[vendorIdx];

        if (vendor?.includes('Nut Farms') || driveId?.includes('1hdnfKjDwe')) {
            console.log(`Found at row ${i + 1}:`);
            console.log(`  File_ID: ${driveId}`);
            console.log(`  Vendor: ${vendor}`);

            // Try different hash sources
            const sources = [
                `https://drive.google.com/file/d/${driveId}/view?usp=drivesdk`,
                `https://drive.google.com/file/d/${driveId}`,
                driveId
            ];

            sources.forEach(s => {
                const h = crypto.createHash('md5').update(s).digest('hex').substring(0, 12);
                console.log(`  Source: ${s} -> Hash: ${h}`);
            });
        }
    }
}

debugMatching().catch(console.error);
