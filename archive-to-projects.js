import 'dotenv/config';
import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { supabase } from './api/_supabase.js';

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const FR_GOOGLE_DRIVE_PREFIX = "bui_invoice/original_files/fr_google_drive/";
const PROJECTS_PREFIX = "bui_invoice/projects/";

// List all files with a given prefix
async function listR2Files(prefix) {
    const files = [];
    let continuationToken = null;

    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        }));

        for (const obj of res.Contents || []) {
            files.push({
                key: obj.Key,
                etag: obj.ETag?.replace(/"/g, ''),
                size: obj.Size
            });
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
    } while (continuationToken);

    return files;
}

// Delete files from R2
async function deleteR2Files(keys) {
    if (keys.length === 0) return 0;

    const chunkSize = 1000;
    let deleted = 0;

    for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        await r2.send(new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: {
                Objects: chunk.map(key => ({ Key: key }))
            }
        }));
        deleted += chunk.length;
    }

    return deleted;
}

// Copy file within R2 (server-side copy)
async function copyR2File(sourceKey, destKey) {
    const copySource = `${BUCKET_NAME}/${sourceKey}`;

    const result = await r2.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: copySource,
        Key: destKey,
    }));

    return result.CopyObjectResult?.ETag?.replace(/"/g, '') || null;
}

// Get file ETag
async function getFileEtag(key) {
    try {
        const result = await r2.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));
        return result.ETag?.replace(/"/g, '') || null;
    } catch (err) {
        return null;
    }
}

async function archiveToProjects() {
    console.log('=== Archive Submitted Files to R2 Projects ===\n');

    // 1. Get all files in fr_google_drive (source)
    console.log('1. Listing source files (fr_google_drive)...');
    const sourceFiles = await listR2Files(FR_GOOGLE_DRIVE_PREFIX);
    console.log(`   Found ${sourceFiles.length} files`);

    // Build map: filename -> source key & etag
    const sourceMap = new Map();
    for (const file of sourceFiles) {
        const filename = file.key.replace(FR_GOOGLE_DRIVE_PREFIX, '');
        sourceMap.set(filename, { key: file.key, etag: file.etag });
    }

    // 2. Clear existing projects files
    console.log('\n2. Clearing existing projects files...');
    const existingProjectFiles = await listR2Files(PROJECTS_PREFIX);
    console.log(`   Found ${existingProjectFiles.length} existing files`);

    if (existingProjectFiles.length > 0) {
        const deleted = await deleteR2Files(existingProjectFiles.map(f => f.key));
        console.log(`   Deleted ${deleted} files`);
    }

    // 3. Get all Submitted records from Supabase
    console.log('\n3. Fetching Submitted records from Supabase...');
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, generated_invoice_id, charge_to_project, vendor')
        .eq('status', 'Submitted');

    if (error) {
        console.error('Error fetching invoices:', error.message);
        return;
    }
    console.log(`   Found ${invoices.length} Submitted records`);

    // 4. Build map: file_id -> source filename
    // We need to find which source file corresponds to each invoice
    // The file_id in Supabase should match a file in fr_google_drive
    console.log('\n4. Mapping file_id to source files...');

    // Get all invoices with their file hashes from fr_google_drive
    const { data: allInvoices } = await supabase
        .from('invoices')
        .select('id, file_id, file_ID_HASH')
        .eq('status', 'Submitted');

    // Build map: file_ID_HASH -> invoice id (for matching)
    const hashToInvoice = new Map();
    for (const inv of allInvoices || []) {
        if (inv.file_ID_HASH) {
            hashToInvoice.set(inv.file_ID_HASH, inv.id);
        }
    }

    // Match source files by etag (file_ID_HASH)
    const fileIdToSource = new Map();
    for (const [filename, source] of sourceMap) {
        if (source.etag && hashToInvoice.has(source.etag)) {
            const invId = hashToInvoice.get(source.etag);
            fileIdToSource.set(invId, { filename, ...source });
        }
    }
    console.log(`   Matched ${fileIdToSource.size} files by hash`);

    // 5. Copy files to projects folder
    console.log('\n5. Copying files to projects folder...');
    let copiedCount = 0;
    let errorCount = 0;
    let notFoundCount = 0;

    for (const invoice of invoices) {
        const sourceInfo = fileIdToSource.get(invoice.id);

        if (!sourceInfo) {
            // Try to find by direct filename match or other means
            notFoundCount++;
            continue;
        }

        // Build destination path: projects/{charge_to_project}/{generated_invoice_id}
        const project = invoice.charge_to_project || 'UNKNOWN';
        const invoiceId = invoice.generated_invoice_id || `INV-${invoice.id}`;
        const destKey = `${PROJECTS_PREFIX}${project}/${invoiceId}`;

        try {
            // Copy file
            const newEtag = await copyR2File(sourceInfo.key, destKey);

            // Update Supabase with achieved fields
            const r2Link = `bui_invoice/projects/${project}/${invoiceId}`;

            const { error: updateErr } = await supabase
                .from('invoices')
                .update({
                    achieved_file_id: newEtag || sourceInfo.etag,
                    achieved_file_link: r2Link
                })
                .eq('id', invoice.id);

            if (updateErr) {
                console.error(`   DB Error for ${invoice.id}: ${updateErr.message}`);
            }

            copiedCount++;

            if (copiedCount % 50 === 0) {
                console.log(`   Progress: ${copiedCount}/${invoices.length} copied...`);
            }
        } catch (err) {
            console.error(`   Error copying ${sourceInfo.filename}: ${err.message}`);
            errorCount++;
        }
    }

    console.log(`\n   Copy complete: ${copiedCount} success, ${errorCount} errors, ${notFoundCount} not found`);

    // 6. Verify
    console.log('\n6. Verification...');
    const finalProjectFiles = await listR2Files(PROJECTS_PREFIX);

    const { count: withAchievedId } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('achieved_file_id', 'is', null);

    const { count: withAchievedLink } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .not('achieved_file_link', 'is', null);

    console.log(`\n${'='.repeat(50)}`);
    console.log('ARCHIVE COMPLETE');
    console.log('='.repeat(50));
    console.log(`Submitted records: ${invoices.length}`);
    console.log(`Files in R2 projects: ${finalProjectFiles.length}`);
    console.log(`Records with achieved_file_id: ${withAchievedId}`);
    console.log(`Records with achieved_file_link: ${withAchievedLink}`);
    console.log(`\nMatch: ${finalProjectFiles.length === copiedCount ? '✅ YES' : '❌ NO'}`);
}

archiveToProjects().catch(console.error);
