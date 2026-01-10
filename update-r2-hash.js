import 'dotenv/config';
import { google } from "googleapis";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getDriveAuth } from "./api/_sheets.js";
import { supabase } from './api/_supabase.js';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";
const R2_FR_GOOGLE_DRIVE_PREFIX = "bui_invoice/original_files/fr_google_drive/";

// Sanitize filename (same as local sync)
function sanitizeFilename(name) {
    return name.replace(/:/g, '_');
}

// List all files in Google Drive Test_invoice folder
async function listDriveFiles() {
    const files = [];
    let pageToken = null;

    do {
        const res = await drive.files.list({
            q: `'${TEST_INVOICE_FOLDER_ID}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, mimeType)",
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        for (const file of res.data.files) {
            if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push({
                    driveId: file.id,
                    name: file.name,
                    sanitizedName: sanitizeFilename(file.name)
                });
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return files;
}

// List all files in R2 fr_google_drive folder with ETags
async function listR2Files() {
    const files = [];
    let continuationToken = null;

    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: R2_FR_GOOGLE_DRIVE_PREFIX,
            ContinuationToken: continuationToken,
        }));

        for (const obj of res.Contents || []) {
            const filename = obj.Key.replace(R2_FR_GOOGLE_DRIVE_PREFIX, '');
            const etag = obj.ETag?.replace(/"/g, '') || null;
            files.push({
                key: obj.Key,
                filename: filename,
                etag: etag,
            });
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);

    return files;
}

async function updateFileHashes() {
    console.log('=== Updating file_ID_HASH from R2 fr_google_drive ===\n');

    // 1. Get files from Google Drive Test_invoice
    console.log('1. Listing Google Drive Test_invoice files...');
    const driveFiles = await listDriveFiles();
    console.log(`   Found ${driveFiles.length} files`);

    // Build map: driveId -> sanitizedName
    const driveIdToName = new Map();
    for (const file of driveFiles) {
        driveIdToName.set(file.driveId, file.sanitizedName);
    }

    // 2. Get files from R2 fr_google_drive
    console.log('\n2. Listing R2 fr_google_drive files...');
    const r2Files = await listR2Files();
    console.log(`   Found ${r2Files.length} files`);

    // Build map: filename -> etag
    const filenameToEtag = new Map();
    for (const file of r2Files) {
        filenameToEtag.set(file.filename, file.etag);
    }

    // 3. Get all invoices from Supabase
    console.log('\n3. Fetching invoices from Supabase...');
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, vendor');

    if (error) {
        console.error('Error:', error.message);
        return;
    }
    console.log(`   Found ${invoices.length} invoices`);

    // 4. Clear existing hash values
    console.log('\n4. Clearing existing file_ID_HASH values...');
    await supabase
        .from('invoices')
        .update({ "file_ID_HASH": null })
        .neq('id', 0);

    // 5. Match and update
    console.log('\n5. Matching file_id -> Drive filename -> R2 ETag...');
    let matchedCount = 0;
    let notInDrive = 0;
    let notInR2 = 0;

    for (const invoice of invoices) {
        const fileId = invoice.file_id;

        if (!fileId) {
            notInDrive++;
            continue;
        }

        // Step 1: Find filename in Drive by file_id
        const filename = driveIdToName.get(fileId);

        if (!filename) {
            notInDrive++;
            continue;
        }

        // Step 2: Find ETag in R2 by filename
        const etag = filenameToEtag.get(filename);

        if (!etag) {
            notInR2++;
            continue;
        }

        // Step 3: Update Supabase
        const { error: updateErr } = await supabase
            .from('invoices')
            .update({ "file_ID_HASH": etag })
            .eq('id', invoice.id);

        if (!updateErr) {
            matchedCount++;
        }
    }

    console.log(`   Matched and updated: ${matchedCount}`);
    console.log(`   Not found in Drive: ${notInDrive}`);
    console.log(`   Not found in R2: ${notInR2}`);

    // 6. Final verification
    console.log('\n6. Final verification...');
    const { count: withHash } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('file_ID_HASH', 'is', null);

    const { count: total } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });

    // Sample
    const { data: sample } = await supabase
        .from('invoices')
        .select('file_id, file_ID_HASH, vendor')
        .not('file_ID_HASH', 'is', null)
        .limit(5);

    console.log('\n   Sample matched records:');
    sample?.forEach(s => {
        console.log(`   - ${s.vendor?.substring(0, 25)}: ${s.file_ID_HASH}`);
    });

    console.log(`\n${'='.repeat(50)}`);
    console.log('UPDATE COMPLETE');
    console.log('='.repeat(50));
    console.log(`Total invoices: ${total}`);
    console.log(`With R2 file hash: ${withHash}`);
    console.log(`Without hash: ${total - withHash}`);
}

updateFileHashes().catch(console.error);
