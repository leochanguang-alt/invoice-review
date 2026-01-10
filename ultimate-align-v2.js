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

// Generate a stronger key for records that might share the same file
function getRecordKey(driveId, vendor, amount) {
    const v = (vendor || '').trim().toLowerCase();
    const a = parseFloat((amount || '0').toString().replace(/,/g, '')).toFixed(2);
    return `${driveId}|${v}|${a}`;
}

async function ultimateAlignV2(dryRun = true) {
    console.log(`=== Ultimate Align V2: Sheet -> Supabase (${dryRun ? 'DRY RUN' : 'APPLY'}) ===\n`);

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Fetch Sheet Data
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
    const { data: allSupabase } = await supabase.from('invoices').select('*');
    console.log(`Supabase has ${allSupabase.length} total records.`);

    // 3. Map Sheet records
    const sheetRecords = [];
    const sheetKeys = new Set();

    rows.slice(1).forEach((row, idx) => {
        const driveId = row[mapping.file_id]?.trim();
        if (!driveId) return;

        const vendor = row[mapping.vendor];
        const amount = row[mapping.amount];
        const key = getRecordKey(driveId, vendor, amount);

        sheetRecords.push({
            key,
            driveId,
            vendor,
            amount: parseFloat((amount || '0').toString().replace(/,/g, '')),
            status: row[mapping.status]?.trim(),
            invoiceId: row[mapping.invoice_id]?.trim(),
            row: row
        });
        sheetKeys.add(key);
    });

    // 4. Map Supabase records
    const supMap = new Map(); // key -> record
    allSupabase.forEach(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        const key = getRecordKey(dId, rec.vendor, rec.amount);
        supMap.set(key, rec);
    });

    const toDeleteIds = allSupabase.filter(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        const key = getRecordKey(dId, rec.vendor, rec.amount);
        return !sheetKeys.has(key);
    }).map(r => r.id);

    const toInsert = sheetRecords.filter(sr => !supMap.has(sr.key));
    const toUpdate = [];

    sheetRecords.forEach(sr => {
        const match = supMap.get(sr.key);
        if (match) {
            const statusMismatch = sr.status && sr.status !== match.status;
            const idMismatch = sr.invoiceId && sr.invoiceId !== match.generated_invoice_id;
            if (statusMismatch || idMismatch) {
                toUpdate.push({ id: match.id, status: sr.status, invoiceId: sr.invoiceId });
            }
        }
    });

    console.log(`\nSummary:`);
    console.log(`  - To DELETE: ${toDeleteIds.length}`);
    console.log(`  - To INSERT: ${toInsert.length}`);
    console.log(`  - To UPDATE: ${toUpdate.length}`);

    if (dryRun) {
        if (toInsert.length > 0) {
            console.log('\n--- Examples to INSERT ---');
            toInsert.slice(0, 3).forEach(i => console.log(`  ${i.vendor} | ${i.amount} | ID: ${i.driveId}`));
        }
        if (toDeleteIds.length > 0) {
            console.log('\n--- Examples to DELETE ---');
            allSupabase.filter(r => toDeleteIds.includes(r.id)).slice(0, 3).forEach(d => console.log(`  ID ${d.id}: ${d.vendor} | ${d.amount}`));
        }
        console.log('\n[DRY RUN] Run with --apply to perform these actions.');
        return;
    }

    // Apply
    if (toDeleteIds.length > 0) {
        console.log(`Deleting ${toDeleteIds.length} records...`);
        for (let i = 0; i < toDeleteIds.length; i += 50) {
            await supabase.from('invoices').delete().in('id', toDeleteIds.slice(i, i + 50));
        }
    }

    if (toInsert.length > 0) {
        console.log(`Inserting ${toInsert.length} records...`);
        for (const sr of toInsert) {
            const newRec = {
                file_id: sr.driveId.substring(0, 12),
                file_link: `https://drive.google.com/uc?id=${sr.driveId}&export=download`,
                vendor: sr.vendor,
                amount: sr.amount,
                currency: sr.row[mapping.currency],
                invoice_date: sr.row[mapping.invoice_date] || null,
                status: sr.status || 'Waiting for Confirm',
                generated_invoice_id: (sr.invoiceId === 'null' || !sr.invoiceId) ? null : sr.invoiceId
            };
            await supabase.from('invoices').insert([newRec]);
        }
    }

    if (toUpdate.length > 0) {
        console.log(`Updating ${toUpdate.length} records...`);
        for (const up of toUpdate) {
            const updates = { status: up.status };
            if (up.invoiceId && up.invoiceId !== 'null') updates.generated_invoice_id = up.invoiceId;
            await supabase.from('invoices').update(updates).eq('id', up.id);
        }
    }

    console.log('\n=== Align V2 Complete ===');
    const finalCount = (await supabase.from('invoices').select('*', { count: 'exact', head: true })).count;
    console.log(`Final Supabase Count: ${finalCount}`);
}

const applyMode = process.argv.includes('--apply');
ultimateAlignV2(!applyMode).catch(console.error);
