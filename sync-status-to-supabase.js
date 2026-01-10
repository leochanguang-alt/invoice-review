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

async function syncStatus() {
    console.log('=== Syncing Status from Google Sheets to Supabase (Robust Mode) ===\n');

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
    if (rows.length < 2) {
        console.log('No data found in Google Sheet.');
        return;
    }

    const headers = rows[0].map(h => h.trim());
    const fileIdIdx = headers.indexOf('File_ID');
    const statusIdx = headers.indexOf('Status');
    const invoiceIdIdx = headers.indexOf('Invoice_ID');

    console.log(`Processing ${rows.length - 1} rows from Sheet...`);

    let updatedStatusCount = 0;
    let reconciledInvoiceIdCount = 0;
    let notFoundCount = 0;
    let alreadyCorrectCount = 0;

    // Cache Supabase records to avoid too many requests
    console.log('Fetching Supabase records for mapping...');
    const { data: allSupabase, error: supaErr } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, status, generated_invoice_id');

    if (supaErr) {
        console.error('Failed to fetch Supabase data:', supaErr.message);
        return;
    }

    console.log(`Loaded ${allSupabase.length} records from Supabase.`);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveId = row[fileIdIdx]?.trim();
        const sheetStatus = row[statusIdx]?.trim();
        const sheetInvoiceId = row[invoiceIdIdx]?.trim();

        if (!driveId) continue;

        // Find matching record in Supabase
        // We look for driveId within the file_link or file_id
        const matchingRecord = allSupabase.find(rec =>
            (rec.file_link && rec.file_link.includes(driveId)) ||
            (rec.file_id === driveId)
        );

        if (!matchingRecord) {
            notFoundCount++;
            continue;
        }

        const updates = {};
        if (sheetStatus && sheetStatus !== matchingRecord.status) {
            updates.status = sheetStatus;
            updatedStatusCount++;
        }
        if (sheetInvoiceId && sheetInvoiceId !== matchingRecord.generated_invoice_id) {
            updates.generated_invoice_id = sheetInvoiceId;
            reconciledInvoiceIdCount++;
        }

        if (Object.keys(updates).length > 0) {
            const { error: updateErr } = await supabase
                .from('invoices')
                .update(updates)
                .eq('id', matchingRecord.id);

            if (updateErr) {
                console.error(`Error updating record ${matchingRecord.id}:`, updateErr.message);
            }
        } else {
            alreadyCorrectCount++;
        }
    }

    console.log('\n=== Sync Complete ===');
    console.log(`Status updated: ${updatedStatusCount}`);
    console.log(`Invoice IDs reconciled: ${reconciledInvoiceIdCount}`);
    console.log(`Already correct: ${alreadyCorrectCount}`);
    console.log(`Not found in Supabase: ${notFoundCount}`);
    console.log(`Note: Supabase has ${allSupabase.length} total records, Sheet has ${rows.length - 1} records.`);
}

syncStatus().catch(console.error);
