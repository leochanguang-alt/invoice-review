import 'dotenv/config';
import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT?.replace(/\/$/, ''),
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const BUCKET = process.env.R2_BUCKET_NAME || 'buiservice-assets';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://assets.buiservice.com';

async function fixR2Extensions() {
    console.log('=== Fix R2 File Extensions ===\n');
    
    // Step 1: List all files in projects folder
    console.log('Step 1: Scanning R2 project folder...');
    let token;
    const filesToFix = [];
    
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: 'bui_invoice/projects/',
            ContinuationToken: token
        }));
        
        for (const file of (res.Contents || [])) {
            const key = file.Key;
            const fileName = key.split('/').pop();
            
            // Skip placeholders and empty
            if (!fileName || fileName === '.placeholder') continue;
            
            // Check if missing extension
            if (!fileName.includes('.')) {
                filesToFix.push(key);
            }
        }
        token = res.NextContinuationToken;
    } while (token);
    
    console.log(`Found ${filesToFix.length} files missing extensions\n`);
    
    if (filesToFix.length === 0) {
        console.log('No files need to be fixed');
        return;
    }
    
    // Step 2: Rename files in R2 (copy + delete)
    console.log('Step 2: Renaming R2 files...');
    let fixed = 0;
    let failed = 0;
    const fixedMappings = []; // old key -> new key
    
    for (const oldKey of filesToFix) {
        const newKey = oldKey + '.pdf';
        
        try {
            // Copy to new name
            await r2.send(new CopyObjectCommand({
                Bucket: BUCKET,
                CopySource: `${BUCKET}/${encodeURIComponent(oldKey).replace(/%2F/g, '/')}`,
                Key: newKey,
            }));
            
            // Delete old file
            await r2.send(new DeleteObjectCommand({
                Bucket: BUCKET,
                Key: oldKey,
            }));
            
            fixedMappings.push({ oldKey, newKey });
            fixed++;
            
            if (fixed % 50 === 0) {
                console.log(`  Processed ${fixed}/${filesToFix.length}`);
            }
        } catch (err) {
            console.error(`  Failed: ${oldKey} - ${err.message}`);
            failed++;
        }
    }
    
    console.log(`\nR2 rename complete: Success ${fixed}, Failed ${failed}\n`);
    
    // Step 3: Update Supabase records
    console.log('Step 3: Updating Supabase records...');
    let dbUpdated = 0;
    let dbFailed = 0;
    
    for (const { oldKey, newKey } of fixedMappings) {
        // Extract the old filename (without path) to match in DB
        const oldFileName = oldKey.split('/').pop();
        
        // Find records with this achieved_file_id
        const { data: records, error: findErr } = await supabase
            .from('invoices')
            .select('id, achieved_file_id, achieved_file_link')
            .or(`achieved_file_id.eq.${oldKey},achieved_file_id.eq.${oldFileName}`);
        
        if (findErr) {
            console.error(`  Query failed: ${oldFileName} - ${findErr.message}`);
            continue;
        }
        
        for (const rec of (records || [])) {
            const newLink = `${R2_PUBLIC_URL}/${newKey}`;
            
            const { error: updateErr } = await supabase
                .from('invoices')
                .update({
                    achieved_file_id: newKey,
                    achieved_file_link: newLink
                })
                .eq('id', rec.id);
            
            if (updateErr) {
                console.error(`  Update failed ID ${rec.id}: ${updateErr.message}`);
                dbFailed++;
            } else {
                dbUpdated++;
            }
        }
    }
    
    console.log(`\nSupabase update complete: Success ${dbUpdated}, Failed ${dbFailed}`);
    
    // Summary
    console.log('\n=== Fix Complete ===');
    console.log(`R2 files renamed: ${fixed}/${filesToFix.length}`);
    console.log(`Database records updated: ${dbUpdated}`);
}

fixR2Extensions().catch(console.error);
