import 'dotenv/config';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { supabase } from './api/_supabase.js';

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const FR_GOOGLE_DRIVE_PREFIX = 'bui_invoice/original_files/fr_google_drive/';

async function cleanupExtraR2Files() {
    console.log('=== Cleanup Extra R2 Files ===\n');

    // 1. Get all R2 files with ETags
    console.log('1. Listing R2 fr_google_drive files...');
    let r2Files = [];
    let token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: FR_GOOGLE_DRIVE_PREFIX,
            ContinuationToken: token
        }));
        for (const f of res.Contents || []) {
            r2Files.push({
                key: f.Key,
                etag: f.ETag?.replace(/"/g, ''),
                name: f.Key.split('/').pop()
            });
        }
        token = res.IsTruncated ? res.NextContinuationToken : null;
    } while (token);
    console.log(`   Found ${r2Files.length} files in R2`);

    // 2. Get all Supabase file_ID_HASH values
    console.log('\n2. Fetching Supabase file_ID_HASH values...');
    const { data: invoices } = await supabase.from('invoices').select('file_ID_HASH');
    const supabaseHashes = new Set(invoices.map(i => i.file_ID_HASH).filter(Boolean));
    console.log(`   Found ${supabaseHashes.size} unique hashes in Supabase`);

    // 3. Find R2 files not in Supabase
    console.log('\n3. Finding extra R2 files...');
    const extraFiles = r2Files.filter(f => !supabaseHashes.has(f.etag));
    console.log(`   Extra files (not in Supabase): ${extraFiles.length}`);

    if (extraFiles.length > 0) {
        console.log('\n   Sample extra files:');
        extraFiles.slice(0, 10).forEach(f => {
            console.log(`   - ${f.name} (etag: ${f.etag})`);
        });
    }

    // 4. Delete extra files
    if (extraFiles.length > 0) {
        console.log(`\n4. Deleting ${extraFiles.length} extra files...`);
        const keysToDelete = extraFiles.map(f => f.key);

        const chunkSize = 1000;
        let deleted = 0;
        for (let i = 0; i < keysToDelete.length; i += chunkSize) {
            const chunk = keysToDelete.slice(i, i + chunkSize);
            await r2.send(new DeleteObjectsCommand({
                Bucket: BUCKET_NAME,
                Delete: { Objects: chunk.map(key => ({ Key: key })) }
            }));
            deleted += chunk.length;
            console.log(`   Deleted ${deleted}/${keysToDelete.length}...`);
        }
        console.log('   Done!');
    } else {
        console.log('\n4. No extra files to delete.');
    }

    // 5. Verify
    console.log('\n5. Verification...');
    let finalCount = 0;
    token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: FR_GOOGLE_DRIVE_PREFIX,
            ContinuationToken: token
        }));
        finalCount += (res.Contents || []).length;
        token = res.IsTruncated ? res.NextContinuationToken : null;
    } while (token);

    console.log(`\n${'='.repeat(50)}`);
    console.log('CLEANUP COMPLETE');
    console.log('='.repeat(50));
    console.log(`R2 fr_google_drive files: ${finalCount}`);
    console.log(`Supabase records: ${invoices.length}`);
    console.log(`Match: ${finalCount === invoices.length ? '✅ YES' : '❌ NO'}`);
}

cleanupExtraR2Files().catch(console.error);
