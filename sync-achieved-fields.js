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

async function syncAchievedFields() {
    console.log('=== Sync Achieved_File_ID & Achieved_File_link to Supabase ===\n');

    // Setup OAuth2
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 1. Fetch Sheet Data
    console.log('1. Fetching Google Sheet data...');
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Main!A:R',
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = res.data.values || [];
    const headers = rows[0].map(h => (h || '').trim());
    console.log(`   Headers: ${headers.join(', ')}`);
    console.log(`   Total rows: ${rows.length - 1}`);

    // Build column index
    const colIdx = {};
    headers.forEach((h, i) => colIdx[h] = i);

    // Check required columns
    const fileIdIdx = colIdx['File_ID'];
    const achievedFileIdIdx = colIdx['Achieved_File_ID'];
    const achievedFileLinkIdx = colIdx['Achieved_File_link'];

    console.log(`\n   Column indices:`);
    console.log(`   - File_ID: ${fileIdIdx}`);
    console.log(`   - Achieved_File_ID: ${achievedFileIdIdx}`);
    console.log(`   - Achieved_File_link: ${achievedFileLinkIdx}`);

    // 2. Get all Supabase records
    console.log('\n2. Fetching Supabase records...');
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id');

    if (error) {
        console.error('Error:', error.message);
        return;
    }
    console.log(`   Found ${invoices.length} records`);

    // Build map: file_id -> supabase id
    const fileIdToSupabaseId = new Map();
    for (const inv of invoices) {
        if (inv.file_id) {
            fileIdToSupabaseId.set(inv.file_id, inv.id);
        }
    }

    // 3. Update Supabase records
    console.log('\n3. Updating Supabase with Achieved fields...');
    let updatedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const fileId = row[fileIdIdx]?.trim();
        const achievedFileId = row[achievedFileIdIdx]?.trim() || null;
        const achievedFileLink = row[achievedFileLinkIdx]?.trim() || null;

        if (!fileId) continue;

        // Find corresponding Supabase record
        const supabaseId = fileIdToSupabaseId.get(fileId);

        if (!supabaseId) {
            notFoundCount++;
            continue;
        }

        // Update the record
        const { error: updateErr } = await supabase
            .from('invoices')
            .update({
                achieved_file_id: achievedFileId,
                achieved_file_link: achievedFileLink
            })
            .eq('id', supabaseId);

        if (updateErr) {
            console.error(`   Error updating row ${i + 1}: ${updateErr.message}`);
            errorCount++;
        } else {
            updatedCount++;
        }

        if (updatedCount % 100 === 0) {
            console.log(`   Progress: ${updatedCount} updated...`);
        }
    }

    // 4. Verify
    console.log('\n4. Verification...');
    const { count: withAchievedId } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('achieved_file_id', 'is', null);

    const { count: withAchievedLink } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('achieved_file_link', 'is', null);

    console.log(`\n${'='.repeat(50)}`);
    console.log('SYNC COMPLETE');
    console.log('='.repeat(50));
    console.log(`Updated: ${updatedCount}`);
    console.log(`Not found in Supabase: ${notFoundCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`\nRecords with achieved_file_id: ${withAchievedId}`);
    console.log(`Records with achieved_file_link: ${withAchievedLink}`);
}

syncAchievedFields().catch(console.error);
