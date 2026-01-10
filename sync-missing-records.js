import 'dotenv/config';
import { google } from 'googleapis';
import crypto from 'crypto';
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

async function syncAll() {
    console.log('=== Full Sync & Recovery (Fixed): Sheet -> Supabase ===\n');

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    console.log('Fetching Google Sheet data...');
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:Z',
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = res.data.values || [];
    const headers = rows[0].map(h => (h || '').trim());

    const mapping = {
        file_id: headers.indexOf('File_ID'),
        status: headers.indexOf('Status'),
        vendor: headers.indexOf('Vendor'),
        amount: headers.indexOf('amount'),
        currency: headers.indexOf('currency'),
        invoice_date: headers.indexOf('Invoice_data'),
        invoice_id: headers.indexOf('Invoice_ID'),
        file_link: headers.indexOf('Achieved_File_link') || headers.indexOf('file_link')
    };

    console.log(`Sheet rows: ${rows.length - 1}`);

    console.log('Fetching all Supabase records...');
    const { data: allSupabase } = await supabase.from('invoices').select('id, file_link, vendor, amount, status');
    console.log(`Supabase records: ${allSupabase.length}`);

    let insertedCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveId = row[mapping.file_id]?.trim();
        const vendor = row[mapping.vendor];
        const amountStr = (row[mapping.amount] || '0').replace(/,/g, '');
        const amount = parseFloat(amountStr);

        if (!driveId) continue;

        // Check if exists in Supabase
        const exists = allSupabase.some(rec => (rec.file_link && rec.file_link.includes(driveId)));

        if (!exists) {
            console.log(`Row ${i + 1}: MISSING (${vendor} ${amount}). Inserting...`);

            // Generate standard hash for file_id
            const source = `https://drive.google.com/file/d/${driveId}/view?usp=drivesdk`;
            const hash = crypto.createHash('md5').update(source).digest('hex').substring(0, 12);

            const newRecord = {
                file_id: hash,
                file_link: `https://drive.google.com/uc?id=${driveId}&export=download`,
                vendor: vendor,
                amount: amount,
                currency: row[mapping.currency],
                invoice_date: row[mapping.invoice_date] || null,
                status: row[mapping.status] || 'Waiting for Confirm',
                generated_invoice_id: (row[mapping.invoice_id] === 'null' || !row[mapping.invoice_id]) ? null : row[mapping.invoice_id]
            };

            const { error } = await supabase.from('invoices').insert([newRecord]);
            if (error) {
                console.error(`Error inserting Row ${i + 1}:`, error.message);
            } else {
                insertedCount++;
            }
        }
    }

    console.log(`\n=== Sync Result ===`);
    console.log(`Rows inserted: ${insertedCount}`);

    const { count } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
    console.log(`Final Supabase Count: ${count}`);
}

syncAll().catch(console.error);
