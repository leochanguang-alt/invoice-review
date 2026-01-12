import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import { supabase } from './api/_supabase.js';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

// Google Drive folder ID for test_invoice
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";

function sanitizeName(name) {
    if (!name) return "";
    return name.replace(/[\\\/:*?"<>|]/g, '_').trim();
}

async function listDriveFiles(folderId) {
    const files = [];
    let pageToken = null;
    
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
        });
        
        for (const file of res.data.files) {
            if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push({
                    id: file.id,
                    name: file.name,
                    sanitizedName: sanitizeName(file.name)
                });
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    
    return files;
}

async function fixMissingFileIds() {
    console.log('--- Fixing Missing file_id in Supabase ---\n');
    
    if (!supabase) {
        console.error('Supabase not initialized');
        return;
    }
    
    // 1. Get records with NULL file_id
    const { data: nullRecords, error: fetchError } = await supabase
        .from('invoices')
        .select('id, file_link_r2, file_id')
        .is('file_id', null);
    
    if (fetchError) {
        console.error('Error fetching records:', fetchError.message);
        return;
    }
    
    console.log(`Found ${nullRecords?.length || 0} records with NULL file_id\n`);
    
    if (!nullRecords || nullRecords.length === 0) {
        console.log('Nothing to fix!');
        return;
    }
    
    // 2. List all files in Google Drive folder
    console.log('Listing Google Drive files...');
    const driveFiles = await listDriveFiles(TEST_INVOICE_FOLDER_ID);
    console.log(`Found ${driveFiles.length} files in Drive\n`);
    
    // 3. Match and update
    let fixed = 0;
    let notFound = 0;
    
    for (const record of nullRecords) {
        const r2Link = record.file_link_r2 || '';
        
        // Extract filename from R2 link
        // Format: https://pub-xxx.r2.dev/bui_invoice/original_files/fr_google_drive/filename.pdf
        const r2Filename = r2Link.split('/').pop();
        
        if (!r2Filename) {
            console.log(`[SKIP] Record ${record.id}: No filename in file_link_r2`);
            notFound++;
            continue;
        }
        
        // Find matching Drive file by sanitized name
        const matchedFile = driveFiles.find(f => f.sanitizedName === r2Filename);
        
        if (matchedFile) {
            console.log(`[MATCH] Record ${record.id}: ${r2Filename} -> Drive ID: ${matchedFile.id}`);
            
            // Update Supabase record
            const { error: updateError } = await supabase
                .from('invoices')
                .update({ 
                    file_id: matchedFile.id,
                })
                .eq('id', record.id);
            
            if (updateError) {
                console.error(`  [ERROR] Update failed:`, updateError.message);
            } else {
                console.log(`  [OK] Updated successfully`);
                fixed++;
            }
        } else {
            console.log(`[NOT FOUND] Record ${record.id}: ${r2Filename} - no matching Drive file`);
            notFound++;
        }
    }
    
    console.log(`\n--- Summary ---`);
    console.log(`Fixed: ${fixed}`);
    console.log(`Not found: ${notFound}`);
}

fixMissingFileIds().catch(console.error);
