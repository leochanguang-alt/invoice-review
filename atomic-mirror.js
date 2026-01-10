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

async function atomicMirror() {
    console.log('=== Atomic Mirror Sync: FULL REBUILD ===\n');

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Fetch Sheet Data
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
        invoice_number: headers.indexOf('invoice_number'),
        location: headers.indexOf('Location(City)'),
        country: headers.indexOf('Country'),
        category: headers.indexOf('category'),
        charge_company: headers.indexOf('Charge_to_company'),
        charge_project: headers.indexOf('Charge_to_project'),
        owner: headers.indexOf('record_owner'),
        invoice_id: headers.indexOf('Invoice_ID'),
        file_link: headers.indexOf('Achieved_File_link') || headers.indexOf('file_link')
    };

    console.log(`Sheet has ${rows.length - 1} records ready to mirror.`);

    // 2. Clear Existing Records in Supabase
    console.log('Clearing all existing records in Supabase (invoices)...');
    const { error: clearErr } = await supabase.from('invoices').delete().neq('id', 0); // Delete all
    if (clearErr) {
        console.error('Failed to clear Supabase:', clearErr.message);
        return;
    }

    // 3. Prepare Batch Insert
    console.log('Preparing batch insert...');
    const toInsert = rows.slice(1).map((row, idx) => {
        const driveId = row[mapping.file_id]?.trim();
        if (!driveId) return null;

        // Standardized Hash
        const source = `https://drive.google.com/file/d/${driveId}/view?usp=drivesdk`;
        // Add row index to ensure uniqueness even for identical business records
        const hash = crypto.createHash('md5').update(source + idx).digest('hex').substring(0, 12);

        return {
            file_id: hash,
            file_link: `https://drive.google.com/uc?id=${driveId}&export=download`,
            vendor: row[mapping.vendor] || null,
            amount: parseFloat((row[mapping.amount] || '0').toString().replace(/,/g, '')) || 0,
            currency: row[mapping.currency] || null,
            invoice_date: row[mapping.invoice_date] || null,
            invoice_number: row[mapping.invoice_number] || null,
            location_city: row[mapping.location] || null,
            country: row[mapping.country] || null,
            category: row[mapping.category] || null,
            status: row[mapping.status]?.trim() || 'Waiting for Confirm',
            charge_to_company: row[mapping.charge_company] || null,
            charge_to_project: row[mapping.charge_project] || null,
            owner_name: row[mapping.owner] || null,
            generated_invoice_id: (row[mapping.invoice_id] === 'null' || !row[mapping.invoice_id]) ? null : row[mapping.invoice_id]
        };
    }).filter(Boolean);

    // 4. Batch Insert
    const chunkSize = 50;
    let insertedCount = 0;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error: insErr } = await supabase.from('invoices').insert(chunk);
        if (insErr) {
            console.error(`Insert error at chunk ${i}:`, insErr.message);
        } else {
            insertedCount += chunk.length;
        }
    }

    console.log(`\n=== Mirror Success ===`);
    console.log(`Final Supabase Records: ${insertedCount}`);

    // Final Status Distribution
    const { data: stats } = await supabase.from('invoices').select('status');
    const dist = {};
    stats.forEach(s => dist[s.status] = (dist[s.status] || 0) + 1);
    console.log('Final Status Distribution:');
    console.log(JSON.stringify(dist, null, 2));
}

atomicMirror().catch(console.error);
