import 'dotenv/config';
import crypto from 'crypto';
import { getSheetsClient, SHEET_ID, MAIN_SHEET, norm, buildHeaderIndex } from './api/_sheets.js';
import { supabase } from './api/_supabase.js';

async function analyzeDataDiff() {
    console.log('=== Analyzing Data Differences ===\n');

    // 1. Get Google Sheet data
    console.log('1. Loading Google Sheet data...');
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${MAIN_SHEET}!A:Z`,
        valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
        console.log('No data in Google Sheet');
        return;
    }

    const headers = rows[0].map(norm);
    const headerMap = buildHeaderIndex(headers);

    const fileIdIdx = headerMap.get('File_ID') ?? headerMap.get(', OvC');
    const statusIdx = headerMap.get('Status');
    const vendorIdx = headerMap.get('Vendor');
    const amountIdx = headerMap.get('amount');
    const invoiceIdIdx = headerMap.get('Invoice_ID');

    console.log(`   Google Sheet rows: ${rows.length - 1}`);
    console.log(`   File_ID column index: ${fileIdIdx}`);
    console.log(`   Status column index: ${statusIdx}`);

    // Parse Sheet data
    const sheetData = [];
    const statusCounts = {};
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const fileId = norm(row[fileIdIdx] || '');
        const status = norm(row[statusIdx] || '');
        const vendor = norm(row[vendorIdx] || '');
        const amount = norm(row[amountIdx] || '');
        const invoiceId = norm(row[invoiceIdIdx] || '');

        if (fileId || vendor) {
            sheetData.push({ fileId, status, vendor, amount, invoiceId, rowNum: i + 1 });
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
    }

    console.log(`   Valid rows with data: ${sheetData.length}`);
    console.log('   Status distribution in Sheet:');
    for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`      ${status || '(empty)'}: ${count}`);
    }

    // 2. Get Supabase data
    console.log('\n2. Loading Supabase data...');
    const { data: supabaseData, error } = await supabase
        .from('invoices')
        .select('id, file_id, status, vendor, amount, generated_invoice_id');

    if (error) {
        console.error('Supabase error:', error.message);
        return;
    }

    console.log(`   Supabase rows: ${supabaseData.length}`);

    const supaStatusCounts = {};
    for (const item of supabaseData) {
        const status = item.status || '';
        supaStatusCounts[status] = (supaStatusCounts[status] || 0) + 1;
    }
    console.log('   Status distribution in Supabase:');
    for (const [status, count] of Object.entries(supaStatusCounts)) {
        console.log(`      ${status || '(empty)'}: ${count}`);
    }

    // 3. Find discrepancies
    console.log('\n3. Analyzing differences...');

    // Create lookup by file_id
    const supabaseByFileId = new Map();
    for (const item of supabaseData) {
        if (item.file_id) {
            supabaseByFileId.set(item.file_id, item);
        }
    }

    // Check for status mismatches
    let statusMismatches = 0;
    const mismatchExamples = [];

    for (const sheetItem of sheetData) {
        if (sheetItem.fileId) {
            const supaItem = supabaseByFileId.get(sheetItem.fileId);
            if (supaItem && sheetItem.status !== supaItem.status) {
                statusMismatches++;
                if (mismatchExamples.length < 5) {
                    mismatchExamples.push({
                        fileId: sheetItem.fileId,
                        sheetStatus: sheetItem.status,
                        supaStatus: supaItem.status
                    });
                }
            }
        }
    }

    console.log(`   Status mismatches: ${statusMismatches}`);
    if (mismatchExamples.length > 0) {
        console.log('   Examples:');
        for (const ex of mismatchExamples) {
            console.log(`      file_id: ${ex.fileId.substring(0, 20)}... Sheet: "${ex.sheetStatus}" vs Supabase: "${ex.supaStatus}"`);
        }
    }

    // 4. Check file_id format
    console.log('\n4. Checking file_id formats...');
    let googleDriveIdCount = 0;
    let hashIdCount = 0;
    let r2KeyCount = 0;

    for (const item of supabaseData) {
        const id = item.file_id || '';
        if (id.length === 12 && /^[a-f0-9]+$/.test(id)) {
            hashIdCount++;
        } else if (id.includes('/')) {
            r2KeyCount++;
        } else if (id.length > 20) {
            googleDriveIdCount++;
        }
    }
    console.log(`   Hash IDs (12 char): ${hashIdCount}`);
    console.log(`   Google Drive IDs: ${googleDriveIdCount}`);
    console.log(`   R2 Keys (with /): ${r2KeyCount}`);

    console.log('\n=== Analysis Complete ===');
}

analyzeDataDiff().catch(console.error);
