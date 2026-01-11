import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { getSheetsClient, SHEET_ID, MAIN_SHEET, getDriveAuth } from './api/_sheets.js';

// Map Sheet Columns (approximate based on knowledge)
// Column L usually holds the Drive ID or Link in the Sheet
// We need to fetch the sheet data to recover the Drive ID.

async function migrate() {
    console.log("Starting Migration...");

    // 1. Fetch all invoices
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*');

    if (error) {
        console.error("DB Error:", error.message);
        return;
    }
    console.log(`Loaded ${invoices.length} records.`);

    // 2. Fetch Sheet Data (including Headers for column mapping)
    const sheets = getSheetsClient();

    // Dynamic Sheet Name Discovery
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetNames = meta.data.sheets.map(s => s.properties.title);
    console.log(`Available Sheets: ${sheetNames.join(', ')}`);

    let targetSheet = MAIN_SHEET;
    // Check if MAIN_SHEET matches one of the names (trim/case?)
    // Or just check if included.
    if (!sheetNames.includes(targetSheet)) {
        console.log(`Warning: MAIN_SHEET '${MAIN_SHEET}' not found. Using '${sheetNames[0]}'`);
        targetSheet = sheetNames[0];
    }
    // Encode sheet name if needed? Usually googleapis handles it, but range string needs 'Sheet Name'!Range
    // If it has spaces, it should be quoted? 'Sheet Name'!A1?
    // Google API usually expects 'Sheet Name'!Range.
    // Let's create a safe range function.
    const getRange = (range) => `'${targetSheet}'!${range}`;

    // Get headers first
    const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: getRange('A1:Z1'),
    });
    const headers = headerRes.data.values?.[0] || [];
    console.log("Sheet Headers:", headers);

    // Identify Column Indices
    const colMap = {};
    headers.forEach((h, i) => {
        colMap[h.trim()] = i;
    });

    // Fallback indices if headers don't match exactly
    // Observed Headers: ['File_ID', 'Invoice_data', 'Vendor', 'amount', 'currency', 'invoice_number', ...]
    const IDX_INVOICE_NUM = colMap['invoice_number'] !== undefined ? colMap['invoice_number'] : 5;
    const IDX_AMOUNT = colMap['amount'] !== undefined ? colMap['amount'] : 3;
    const IDX_DRIVE_ID = colMap['File_ID'] !== undefined ? colMap['File_ID'] : 0;

    console.log(`Column Mapping: InvoiceNo=${IDX_INVOICE_NUM}, Amount=${IDX_AMOUNT}, DriveID=${IDX_DRIVE_ID}`);

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: getRange('A2:Z'), // Fetch more columns just in case
    });
    const sheetRows = res.data.values || [];
    console.log(`Loaded ${sheetRows.length} sheet rows for reference.`);

    // 3. Process each record
    let updatedCount = 0;

    for (const inv of invoices) {
        let updates = {};

        // A. Migrate R2 Link -> file_link_r2
        if (inv.file_link && !inv.file_link_r2) {
            if (inv.file_link.includes('r2.cloudflarestorage') || inv.file_link.includes('buiservice-assets')) {
                updates.file_link_r2 = inv.file_link;
            }
        }

        // B. Migrate Hash -> file_ID_HASH_R2
        if (inv.file_ID_HASH && !inv.file_ID_HASH_R2) {
            updates.file_ID_HASH_R2 = inv.file_ID_HASH;
        }

        // C. Recover file_id (Google Drive ID)
        // Only if file_id is missing OR looks like an R2 hash (12 chars hex or ETag)
        // Typically Drive IDs are ~33 chars (e.g. 1zaqDknSxpcEpPL9_4wEX7tG5J-09Q3-i)
        // R2 hashes we generate are 12 chars.
        const currentId = inv.file_id || '';
        const seemsLikeR2Hash = currentId.length < 20 || !currentId.includes('-');

        if (seemsLikeR2Hash || !currentId) {
            // Find matching row
            const invNum = (inv.invoice_number || '').trim();
            const invAmount = parseFloat(inv.amount || 0);

            // Search in Sheet Rows
            // Try strict match on Invoice Number first
            let matchedRow = sheetRows.find(row => {
                const sheetInvVal = (row[IDX_INVOICE_NUM] || '').trim();
                // Check Invoice Num match
                if (sheetInvVal === invNum && invNum !== '') return true;
                return false;
            });

            // If not found or ambiguous, refine/fallback
            if (!matchedRow) {
                // Try match by Amount + Vendor roughly?
                // Risk of false positive. Let's stick to Invoice Number mostly.
            }

            if (matchedRow) {
                const driveId = (matchedRow[IDX_DRIVE_ID] || '').trim();
                if (driveId && driveId.length > 20) { // Basic validation
                    updates.file_id = driveId;
                    if (updatedCount < 5) console.log(`Recovered Drive ID for ${inv.id}: ${driveId}`);
                }
            }
        }

        // 1. Update R2 Fields (Safe)
        const r2Updates = {};
        if (updates.file_link_r2) r2Updates.file_link_r2 = updates.file_link_r2;
        if (updates.file_ID_HASH_R2) r2Updates.file_ID_HASH_R2 = updates.file_ID_HASH_R2;

        if (Object.keys(r2Updates).length > 0) {
            const { error: upErr } = await supabase
                .from('invoices')
                .update(r2Updates)
                .eq('id', inv.id);
            if (upErr) console.error(`   Error updating R2 fields for ${inv.id}:`, upErr.message);
            else updatedCount++;
        }

        // 2. Update file_id (Risky - Duplicate Constraint)
        if (updates.file_id) {
            const { error: upErr } = await supabase
                .from('invoices')
                .update({ file_id: updates.file_id })
                .eq('id', inv.id);

            if (upErr) {
                if (upErr.message.includes('duplicate key value') || upErr.code === '23505') {
                    console.log(`   Skipped file_id update for ${inv.id} (Duplicate Drive ID: ${updates.file_id})`);
                } else {
                    console.error(`   Error updating file_id for ${inv.id}:`, upErr.message);
                }
            } else {
                console.log(`   Recovered Drive ID for ${inv.id}: ${updates.file_id}`);
            }
        }
    }

    console.log(`Migration complete.`);
}

migrate().catch(console.error);
