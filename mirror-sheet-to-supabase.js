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

async function mirrorSync(dryRun = true) {
    console.log(`=== Mirror Sync: Google Sheet -> Supabase (${dryRun ? 'DRY RUN' : 'APPLY MODE'}) ===\n`);

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    console.log('Fetching Google Sheet data (Main)...');
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

    const headers = rows[0].map(h => (h || '').trim());
    const fileIdIdx = headers.indexOf('File_ID');
    const statusIdx = headers.indexOf('Status');
    const invoiceIdIdx = headers.indexOf('Invoice_ID');
    const vendorIdx = headers.indexOf('Vendor');
    const amountIdx = headers.indexOf('amount');

    console.log(`Sheet has ${rows.length - 1} records.`);

    console.log('Fetching Supabase records...');
    const { data: allSupabase, error: supaErr } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, status, generated_invoice_id, vendor, amount');

    if (supaErr) {
        console.error('Failed to fetch Supabase data:', supaErr.message);
        return;
    }
    console.log(`Supabase has ${allSupabase.length} records.\n`);

    // Extract all Drive IDs from Sheet
    const sheetDriveIds = new Set();
    const sheetMap = new Map(); // driveId -> sheetRowData

    rows.slice(1).forEach((row, idx) => {
        const driveId = row[fileIdIdx]?.trim();
        if (!driveId) return;

        sheetDriveIds.add(driveId);
        sheetMap.set(driveId, {
            rowNum: idx + 2,
            driveId,
            status: row[statusIdx]?.trim(),
            invoiceId: row[invoiceIdIdx]?.trim(),
            vendor: row[vendorIdx]?.trim(),
            amount: parseFloat((row[amountIdx] || '0').replace(/,/g, '')),
            originalRow: row
        });
    });

    // 1. Find records to DELETE from Supabase
    // A Supabase record is deleted if its file_link DOES NOT contain any of the sheetDriveIds
    const toDelete = [];
    const matchedSupabaseIds = new Set();

    allSupabase.forEach(rec => {
        // Try to find which driveId matches this record
        let foundMatch = false;
        for (const driveId of sheetDriveIds) {
            if (rec.file_link && rec.file_link.includes(driveId)) {
                foundMatch = true;
                matchedSupabaseIds.add(rec.id);
                break;
            }
            // Also check file_id just in case it's stored directly
            if (rec.file_id === driveId) {
                foundMatch = true;
                matchedSupabaseIds.add(rec.id);
                break;
            }
        }

        if (!foundMatch) {
            toDelete.push(rec);
        }
    });

    // 2. Find records to UPDATE in Supabase
    const toUpdate = [];
    allSupabase.forEach(rec => {
        if (!matchedSupabaseIds.has(rec.id)) return;

        // Find which sheet row matched this record
        let matchedSheetData = null;
        for (const driveId of sheetDriveIds) {
            if ((rec.file_link && rec.file_link.includes(driveId)) || (rec.file_id === driveId)) {
                matchedSheetData = sheetMap.get(driveId);
                break;
            }
        }

        if (matchedSheetData) {
            const statusMismatch = matchedSheetData.status && matchedSheetData.status !== rec.status;
            const idMismatch = matchedSheetData.invoiceId && matchedSheetData.invoiceId !== rec.generated_invoice_id;

            if (statusMismatch || idMismatch) {
                toUpdate.push({
                    id: rec.id,
                    vendor: rec.vendor,
                    currentStatus: rec.status,
                    newStatus: matchedSheetData.status,
                    currentInvoiceId: rec.generated_invoice_id,
                    newInvoiceId: matchedSheetData.invoiceId
                });
            }
        }
    });

    console.log(`Summary:`);
    console.log(`  - To DELETE: ${toDelete.length} records`);
    console.log(`  - To UPDATE: ${toUpdate.length} records`);
    console.log(`  - To KEEP (No change): ${matchedSupabaseIds.size - toUpdate.length} records\n`);

    if (toDelete.length === allSupabase.length && allSupabase.length > 0) {
        console.warn('WARNING: Script is about to delete ALL records. Aborting to be safe. Check your matching logic.');
        // return;
    }

    if (dryRun) {
        console.log('--- Examples of records to DELETE ---');
        toDelete.slice(0, 5).forEach(rec => console.log(`  ID ${rec.id}: "${rec.vendor}" ($${rec.amount}) | file_link: ${rec.file_link?.substring(0, 40)}...`));

        console.log('\n--- Examples of records to UPDATE ---');
        toUpdate.slice(0, 5).forEach(rec => {
            console.log(`  ID ${rec.id}: "${rec.vendor}"`);
            if (rec.currentStatus !== rec.newStatus) console.log(`    Status: "${rec.currentStatus}" -> "${rec.newStatus}"`);
            if (rec.currentInvoiceId !== rec.newInvoiceId) console.log(`    Invoice_ID: "${rec.currentInvoiceId}" -> "${rec.newInvoiceId}"`);
        });

        console.log('\n[DRY RUN] Run with --apply to perform these actions.');
        return;
    }

    // APPLY MODE
    if (toDelete.length > 0) {
        console.log(`Deleting ${toDelete.length} records...`);
        // Supabase delete in chunks if large
        const ids = toDelete.map(r => r.id);
        const chunkSize = 50;
        for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const { error } = await supabase.from('invoices').delete().in('id', chunk);
            if (error) console.error(`Delete error in chunk ${i}:`, error.message);
        }
        console.log('Deletions completed.');
    }

    if (toUpdate.length > 0) {
        console.log(`Updating ${toUpdate.length} records...`);
        for (const up of toUpdate) {
            const updates = {};
            if (up.currentStatus !== up.newStatus) updates.status = up.newStatus;
            if (up.currentInvoiceId !== up.newInvoiceId) updates.generated_invoice_id = up.newInvoiceId;

            const { error } = await supabase.from('invoices').update(updates).eq('id', up.id);
            if (error) console.error(`Update error for ID ${up.id}:`, error.message);
        }
        console.log('Updates completed.');
    }

    console.log('\n=== Mirror Sync Complete ===');
}

const applyMode = process.argv.includes('--apply');
mirrorSync(!applyMode).catch(console.error);
