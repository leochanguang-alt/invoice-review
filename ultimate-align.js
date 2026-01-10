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

function extractDriveId(link) {
    if (!link) return null;
    const match = link.match(/[-\w]{25,}/);
    return match ? match[0] : null;
}

async function ultimateAlign() {
    console.log('=== Ultimate Deduplicate and Sync: Sheet -> Supabase ===\n');

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
        invoice_id: headers.indexOf('Invoice_ID'),
        file_link: headers.indexOf('Achieved_File_link') || headers.indexOf('file_link')
    };

    console.log(`Sheet has ${rows.length - 1} records.`);

    // 2. Fetch all Supabase records
    console.log('Fetching all Supabase records for cleanup...');
    const { data: allSupabase } = await supabase.from('invoices').select('*');
    console.log(`Supabase has ${allSupabase.length} total records.`);

    // 3. Deduplicate Supabase by Drive ID
    const driveIdToSupRecords = new Map();
    allSupabase.forEach(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        if (!dId) return;
        if (!driveIdToSupRecords.has(dId)) driveIdToSupRecords.set(dId, []);
        driveIdToSupRecords.get(dId).push(rec);
    });

    const toDeleteIds = [];
    for (const [dId, records] of driveIdToSupRecords.entries()) {
        if (records.length > 1) {
            // Keep the one with the highest ID or most data
            records.sort((a, b) => b.id - a.id);
            const keep = records[0];
            const others = records.slice(1);
            others.forEach(o => toDeleteIds.push(o.id));
        }
    }

    if (toDeleteIds.length > 0) {
        console.log(`Deleting ${toDeleteIds.length} duplicate records from Supabase...`);
        const { error: delErr } = await supabase.from('invoices').delete().in('id', toDeleteIds);
        if (delErr) console.error('Error deleting duplicates:', delErr.message);
    }

    // 4. Mirror Sheet records to Supabase
    // We walk through the Sheet and ensure each record exists and has correct status
    const { data: cleanedSupabase } = await supabase.from('invoices').select('*');
    const supMap = new Map(); // driveId -> record
    cleanedSupabase.forEach(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        if (dId) supMap.set(dId, rec);
    });

    let syncUpdates = 0;
    let syncInserts = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const driveId = row[mapping.file_id]?.trim();
        if (!driveId) continue;

        const sheetStatus = row[mapping.status]?.trim();
        const sheetInvoiceId = row[mapping.invoice_id]?.trim();
        const vendor = row[mapping.vendor];
        const amount = parseFloat((row[mapping.amount] || '0').replace(/,/g, ''));

        const match = supMap.get(driveId);
        if (match) {
            // Update if mismatch
            const needsUpdate = sheetStatus !== match.status ||
                (sheetInvoiceId && sheetInvoiceId !== match.generated_invoice_id);
            if (needsUpdate) {
                const updates = { status: sheetStatus };
                if (sheetInvoiceId && sheetInvoiceId !== 'null') {
                    updates.generated_invoice_id = sheetInvoiceId;
                }
                await supabase.from('invoices').update(updates).eq('id', match.id);
                syncUpdates++;
            }
        } else {
            // Insert missing
            console.log(`Row ${i + 1} (${vendor}) missing. Inserting...`);
            const newRec = {
                file_id: driveId.substring(0, 12),
                file_link: `https://drive.google.com/uc?id=${driveId}&export=download`,
                vendor: vendor,
                amount: amount,
                currency: row[mapping.currency],
                invoice_date: row[mapping.invoice_date] || null,
                status: sheetStatus || 'Waiting for Confirm',
                generated_invoice_id: (sheetInvoiceId === 'null' || !sheetInvoiceId) ? null : sheetInvoiceId
            };
            await supabase.from('invoices').insert([newRec]);
            syncInserts++;
        }
    }

    // 5. Final mirror check: Delete anything in Supabase NOT in Sheet
    const sheetDriveIds = new Set(rows.map(r => r[mapping.file_id]?.trim()).filter(Boolean));
    const finalSupabase = (await supabase.from('invoices').select('id, file_link, file_id')).data;
    const extraIds = [];
    finalSupabase.forEach(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        if (!sheetDriveIds.has(dId)) {
            extraIds.push(rec.id);
        }
    });

    if (extraIds.length > 0) {
        console.log(`Deleting ${extraIds.length} extra records not in Sheet...`);
        await supabase.from('invoices').delete().in('id', extraIds);
    }

    console.log('\n=== Ultimate Sync Result ===');
    console.log(`Updates: ${syncUpdates}`);
    console.log(`Inserts: ${syncInserts}`);
    console.log(`Extras Deleted: ${extraIds.length}`);

    const finalCount = (await supabase.from('invoices').select('*', { count: 'exact', head: true })).count;
    console.log(`Final Supabase Count: ${finalCount}`);

    // Status distribution
    const { data: stats } = await supabase.from('invoices').select('status');
    const dist = {};
    stats.forEach(s => dist[s.status] = (dist[s.status] || 0) + 1);
    console.log('Final Status Distribution:');
    console.log(JSON.stringify(dist, null, 2));
}

ultimateAlign().catch(console.error);
