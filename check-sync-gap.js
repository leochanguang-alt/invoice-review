import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { getSheetsClient, SHEET_ID, MAIN_SHEET, norm, buildHeaderIndex } from './api/_sheets.js';

async function checkSyncGap() {
    console.log('--- Starting Sync Gap Analysis ---');

    if (!supabase) {
        console.error('Error: Supabase client is not initialized.');
        return;
    }

    try {
        // 1. Fetch Supabase file IDs
        console.log('Fetching records from Supabase...');
        const { data: supaData, error: supaError } = await supabase
            .from('invoices')
            .select('file_id, invoice_number, vendor, amount');

        if (supaError) throw supaError;
        const supaIdSet = new Set(supaData.map(r => r.file_id));
        console.log(`Supabase has ${supaData.length} records.`);

        // 2. Fetch Google Sheet records
        const sheets = getSheetsClient();

        // Try to list sheets to verify name
        let targetSheet = MAIN_SHEET;
        try {
            const spreadRes = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
            const sheetTitles = spreadRes.data.sheets.map(s => s.properties.title);
            console.log('Available sheets:', sheetTitles.join(', '));

            if (!sheetTitles.includes(targetSheet)) {
                console.warn(`Warning: Sheet "${targetSheet}" not found.`);
                const fallback = sheetTitles.find(t => t.toLowerCase() === 'main' || t === '工作表1');
                if (fallback) {
                    console.log(`Using fallback sheet: "${fallback}"`);
                    targetSheet = fallback;
                } else {
                    targetSheet = sheetTitles[0];
                    console.log(`Using first available sheet: "${targetSheet}"`);
                }
            }
        } catch (e) {
            console.warn('Could not list sheets, proceeding with:', targetSheet);
        }

        console.log(`Fetching records from Google Sheet: ${targetSheet}...`);
        const sheetRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${targetSheet}!A:Z`,
        });

        const rows = sheetRes.data.values || [];
        if (rows.length === 0) {
            console.log('Sheet is empty.');
            return;
        }

        const headers = rows[0].map(norm);
        console.log('Headers found:', JSON.stringify(headers));
        const headerMap = buildHeaderIndex(headers);

        // Use exact column names based on dump
        const fileIdIdx = headerMap.get('File_ID');
        const vendorIdx = headerMap.get('Vendor');
        const amountIdx = headerMap.get('amount');
        const statusIdx = headerMap.get('Status');

        if (fileIdIdx === undefined) {
            console.error('Could not find File_ID column in sheet.');
            return;
        }

        const sheetRecords = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const fId = norm(row[fileIdIdx]);
            if (fId) {
                sheetRecords.push({
                    rowNumber: i + 1,
                    fileId: fId,
                    vendor: norm(row[vendorIdx]),
                    amount: norm(row[amountIdx]),
                    status: norm(row[statusIdx])
                });
            }
        }
        console.log(`Sheet has ${sheetRecords.length} records with file IDs.`);

        // 3. Compare
        const missingInSupa = sheetRecords.filter(r => {
            const normalizedSheetId = norm(r.fileId);
            return !supaIdSet.has(normalizedSheetId);
        });

        if (missingInSupa.length === 0) {
            console.log('\n✅ NO DISCREPANCY: All sheet records found in Supabase.');
        } else {
            console.log(`\n❌ FOUND ${missingInSupa.length} DISCREPANCIES (In Sheet but NOT in Supabase):`);
            missingInSupa.forEach(r => {
                const normalizedId = norm(r.fileId);
                console.log(`- Row ${r.rowNumber}: FileID: "${normalizedId}" (len: ${normalizedId.length}), Vendor: ${r.vendor}, Amount: ${r.amount}, Status: ${r.status}`);
            });
            console.log('\nSample check of a "missing" ID against Supabase set:', Array.from(supaIdSet).includes(norm(missingInSupa[0].fileId)));
            console.log('\nTo fix these, run:');
            missingInSupa.forEach(r => {
                console.log(`node process-manual.js ${r.fileId}`);
            });
        }

    } catch (err) {
        console.error('Check Sync Gap Error:', err.message || err);
    }
}

checkSyncGap();
