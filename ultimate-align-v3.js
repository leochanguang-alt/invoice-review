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

function getRecordKey(driveId, vendor, amount) {
    const v = (vendor || '').trim().toLowerCase();
    const cleanAmount = (amount || '0').toString().replace(/,/g, '');
    let aValue = parseFloat(cleanAmount);
    if (isNaN(aValue)) aValue = 0;
    const a = aValue.toFixed(2);
    return `${driveId}|${v}|${a}`;
}

async function ultimateAlignV3(dryRun = true) {
    console.log(`=== Ultimate Align V3: Fixed Key Mirroring (${dryRun ? 'DRY RUN' : 'APPLY'}) ===\n`);

    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

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

    const { data: allSupabase } = await supabase.from('invoices').select('*');
    console.log(`Supabase has ${allSupabase.length} total records.`);

    const sheetGroups = new Map();
    rows.slice(1).forEach((row, idx) => {
        const driveId = row[mapping.file_id]?.trim();
        if (!driveId) return;
        const key = getRecordKey(driveId, row[mapping.vendor], row[mapping.amount]);
        if (!sheetGroups.has(key)) sheetGroups.set(key, []);
        sheetGroups.get(key).push({
            driveId, vendor: row[mapping.vendor],
            amount: parseFloat((row[mapping.amount] || '0').toString().replace(/,/g, '')),
            status: row[mapping.status]?.trim(),
            invoiceId: row[mapping.invoice_id]?.trim(),
            row: row
        });
    });

    const supGroups = new Map();
    allSupabase.forEach(rec => {
        const dId = extractDriveId(rec.file_link) || rec.file_id;
        const key = getRecordKey(dId, rec.vendor, rec.amount);
        if (!supGroups.has(key)) supGroups.set(key, []);
        supGroups.get(key).push(rec);
    });

    const toInsert = [];
    const toDeleteIds = [];
    const toUpdate = [];

    // Keys in Sheet
    for (const [key, sheetRows] of sheetGroups.entries()) {
        const supRecs = supGroups.get(key) || [];
        if (sheetRows.length > supRecs.length) {
            const diff = sheetRows.length - supRecs.length;
            for (let i = 0; i < diff; i++) toInsert.push(sheetRows[supRecs.length + i]);
        }
        const limit = Math.min(sheetRows.length, supRecs.length);
        for (let i = 0; i < limit; i++) {
            const sr = sheetRows[i];
            const rec = supRecs[i];
            const needsUpdate = sr.status !== rec.status || sr.invoiceId !== rec.generated_invoice_id;
            if (needsUpdate) toUpdate.push({ id: rec.id, status: sr.status, invoiceId: sr.invoiceId });
        }
    }

    // Keys and Excess in Supabase
    for (const [key, supRecs] of supGroups.entries()) {
        const sheetRows = sheetGroups.get(key) || [];
        if (supRecs.length > sheetRows.length) {
            const excess = supRecs.slice(sheetRows.length);
            excess.forEach(r => toDeleteIds.push(r.id));
        }
    }

    console.log(`\nMirror Summary:`);
    console.log(`  - To DELETE: ${toDeleteIds.length}`);
    console.log(`  - To INSERT: ${toInsert.length}`);
    console.log(`  - To UPDATE: ${toUpdate.length}`);

    if (dryRun) return console.log('\n[DRY RUN] Run with --apply.');

    if (toDeleteIds.length > 0) {
        for (let i = 0; i < toDeleteIds.length; i += 50) await supabase.from('invoices').delete().in('id', toDeleteIds.slice(i, i + 50));
    }
    if (toInsert.length > 0) {
        for (const sr of toInsert) {
            await supabase.from('invoices').insert([{
                file_id: sr.driveId.substring(0, 12) + Math.random().toString(36).substring(7),
                file_link: `https://drive.google.com/uc?id=${sr.driveId}&export=download`,
                vendor: sr.vendor, amount: isNaN(sr.amount) ? 0 : sr.amount,
                currency: sr.row[mapping.currency], invoice_date: sr.row[mapping.invoice_date] || null,
                status: sr.status || 'Waiting for Confirm',
                generated_invoice_id: (sr.invoiceId === 'null' || !sr.invoiceId) ? null : sr.invoiceId
            }]);
        }
    }
    if (toUpdate.length > 0) {
        for (const up of toUpdate) {
            const upd = { status: up.status };
            if (up.invoiceId && up.invoiceId !== 'null') upd.generated_invoice_id = up.invoiceId;
            await supabase.from('invoices').update(upd).eq('id', up.id);
        }
    }
    console.log('\n=== Align V3 Complete ===');
    const finalCount = (await supabase.from('invoices').select('*', { count: 'exact', head: true })).count;
    console.log(`Final Supabase Count: ${finalCount}`);
}

const applyMode = process.argv.includes('--apply');
ultimateAlignV3(!applyMode).catch(console.error);
