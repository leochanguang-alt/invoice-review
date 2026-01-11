import 'dotenv/config';
import { google } from "googleapis";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getDriveAuth } from "./api/_sheets.js";
import { supabase } from './api/_supabase.js';
import crypto from 'crypto';

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
const R2_FR_GOOGLE_DRIVE_PREFIX = "bui_invoice/original_files/fr_google_drive/";

// Extract Drive file ID from file_link
function extractDriveId(fileLink) {
    if (!fileLink) return null;
    // Try various URL patterns
    let match = fileLink.match(/id=([^&]+)/);
    if (match) return match[1];
    match = fileLink.match(/\/d\/([^\/]+)/);
    if (match) return match[1];
    return null;
}

// Sanitize filename for Windows/R2 compatibility
function sanitizeFilename(name) {
    if (!name) return "";
    return name.replace(/[\\\/:*?"<>|]/g, '_').trim();
}

// List all existing files in R2 fr_google_drive
async function listExistingR2Files() {
    const files = [];
    let continuationToken = null;

    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: R2_FR_GOOGLE_DRIVE_PREFIX,
            ContinuationToken: continuationToken,
        }));

        for (const obj of res.Contents || []) {
            files.push(obj.Key);
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);

    return files;
}

// Delete files from R2
async function deleteR2Files(keys) {
    if (keys.length === 0) return;

    // Delete in chunks of 1000 (S3 limit)
    const chunkSize = 1000;
    for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        await r2.send(new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: {
                Objects: chunk.map(key => ({ Key: key }))
            }
        }));
    }
}

async function syncAllFilesToR2() {
    console.log('=== Sync All Files to R2 fr_google_drive ===\n');

    // 1. Get existing R2 files (to delete later)
    console.log('1. Listing existing R2 files...');
    const existingR2Files = await listExistingR2Files();
    console.log(`   Found ${existingR2Files.length} existing files to be replaced`);

    // 2. Get all invoices from Supabase
    console.log('\n2. Fetching invoices from Supabase...');
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, vendor');

    if (error) {
        console.error('Error:', error.message);
        return;
    }
    console.log(`   Found ${invoices.length} invoices to process`);

    // 3. Process each invoice
    console.log('\n3. Copying files from Google Drive to R2...');
    const newR2Keys = [];
    let successCount = 0;
    let errorCount = 0;
    let skipCount = 0;

    for (let i = 0; i < invoices.length; i++) {
        const invoice = invoices[i];
        const progress = `[${i + 1}/${invoices.length}]`;

        // Get Drive file ID
        let driveId = invoice.file_id;
        if (!driveId && invoice.file_link) {
            driveId = extractDriveId(invoice.file_link);
        }

        if (!driveId) {
            console.log(`${progress} Skip: No file ID for invoice ${invoice.id}`);
            skipCount++;
            continue;
        }

        try {
            // Get file metadata from Drive
            const fileInfo = await drive.files.get({
                fileId: driveId,
                fields: 'name, mimeType',
                supportsAllDrives: true
            });

            const originalName = fileInfo.data.name;
            const sanitizedName = sanitizeFilename(originalName);
            const mimeType = fileInfo.data.mimeType;

            // Skip Google Docs native files
            if (mimeType.startsWith('application/vnd.google-apps.')) {
                console.log(`${progress} Skip: Google Doc - ${originalName}`);
                skipCount++;
                continue;
            }

            // Download from Drive
            const response = await drive.files.get(
                { fileId: driveId, alt: "media" },
                { responseType: "stream" }
            );

            // Upload to R2 (skip if already exists)
            const r2Key = `${R2_FR_GOOGLE_DRIVE_PREFIX}${sanitizedName}`;

            try {
                await r2.send(new HeadObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: r2Key,
                }));
                console.log(`${progress} Skip: already exists in R2 -> ${r2Key}`);
                skipCount++;
                continue;
            } catch (e) {
                // Not found -> proceed
            }

            const upload = new Upload({
                client: r2,
                params: {
                    Bucket: BUCKET_NAME,
                    Key: r2Key,
                    Body: response.data,
                    ContentType: mimeType,
                },
            });

            const uploadResult = await upload.done();

            // Get ETag from upload result
            const etag = uploadResult.ETag?.replace(/"/g, '') || null;

            // Update Supabase with the hash
            const { error: updateErr } = await supabase
                .from('invoices')
                .update({ "file_ID_HASH": etag })
                .eq('id', invoice.id);

            if (updateErr) {
                console.error(`${progress} DB Error: ${updateErr.message}`);
            }

            newR2Keys.push(r2Key);
            successCount++;

            if (successCount % 50 === 0 || i === invoices.length - 1) {
                console.log(`${progress} Progress: ${successCount} uploaded, ${errorCount} errors, ${skipCount} skipped`);
            }

        } catch (err) {
            console.error(`${progress} Error for invoice ${invoice.id}: ${err.message}`);
            errorCount++;
        }
    }

    console.log(`\n   Upload complete: ${successCount} success, ${errorCount} errors, ${skipCount} skipped`);

    // 4. Delete old files that are not in the new set
    console.log('\n4. Cleaning up old R2 files...');
    const newKeySet = new Set(newR2Keys);
    const filesToDelete = existingR2Files.filter(key => !newKeySet.has(key));

    if (filesToDelete.length > 0) {
        console.log(`   Deleting ${filesToDelete.length} old files...`);
        await deleteR2Files(filesToDelete);
        console.log('   Done!');
    } else {
        console.log('   No old files to delete');
    }

    // 5. Verify
    console.log('\n5. Verification...');
    const finalR2Files = await listExistingR2Files();

    const { count: withHash } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('file_ID_HASH', 'is', null);

    const { count: total } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true });

    console.log(`\n${'='.repeat(50)}`);
    console.log('SYNC COMPLETE');
    console.log('='.repeat(50));
    console.log(`Total invoices: ${total}`);
    console.log(`Files in R2 fr_google_drive: ${finalR2Files.length}`);
    console.log(`Invoices with file_ID_HASH: ${withHash}`);
    console.log(`Success rate: ${((withHash / total) * 100).toFixed(1)}%`);
}

syncAllFilesToR2().catch(console.error);
