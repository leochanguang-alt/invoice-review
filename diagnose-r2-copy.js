import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

async function checkFileExists(key) {
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key
        }));
        return true;
    } catch (e) {
        return false;
    }
}

async function listProjectFiles(projectCode) {
    try {
        const prefix = `bui_invoice/projects/${projectCode}/`;
        const result = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: 100
        }));
        return (result.Contents || []).map(c => c.Key);
    } catch (e) {
        console.error(`Error listing files for ${projectCode}:`, e.message);
        return [];
    }
}

async function main() {
    console.log('=== Diagnose R2 File Copy Issues ===\n');

    // Get all submitted records
    const { data: submittedRecords, error } = await supabase
        .from('invoices')
        .select('id, generated_invoice_id, file_id, file_link, file_link_r2, achieved_file_link, achieved_file_id, charge_to_project, status')
        .eq('status', 'Submitted')
        .order('id', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Failed to get records:', error.message);
        return;
    }

    console.log(`Found ${submittedRecords.length} submitted records\n`);

    let withAchievedFile = 0;
    let withoutAchievedFile = 0;
    let fileExistsInR2 = 0;
    let fileMissingInR2 = 0;

    const problemRecords = [];

    for (const record of submittedRecords) {
        const hasAchievedFile = record.achieved_file_link || record.achieved_file_id;
        
        if (hasAchievedFile) {
            withAchievedFile++;
            
            // Check if file really exists in R2
            let fileKey = record.achieved_file_id;
            if (!fileKey && record.achieved_file_link) {
                const match = record.achieved_file_link.match(/bui_invoice\/.*$/);
                if (match) fileKey = match[0];
            }
            
            if (fileKey) {
                const exists = await checkFileExists(fileKey);
                if (exists) {
                    fileExistsInR2++;
                } else {
                    fileMissingInR2++;
                    problemRecords.push({
                        id: record.id,
                        invoiceId: record.generated_invoice_id,
                        reason: 'achieved_file_id exists but file not in R2',
                        fileKey
                    });
                }
            }
        } else {
            withoutAchievedFile++;
            problemRecords.push({
                id: record.id,
                invoiceId: record.generated_invoice_id,
                reason: 'No achieved_file_link/achieved_file_id',
                file_id: record.file_id,
                file_link_r2: record.file_link_r2,
                charge_to_project: record.charge_to_project
            });
        }
    }

    console.log('=== Statistics ===');
    console.log(`Has achieved_file: ${withAchievedFile}`);
    console.log(`No achieved_file: ${withoutAchievedFile}`);
    console.log(`File actually exists in R2: ${fileExistsInR2}`);
    console.log(`File not found in R2: ${fileMissingInR2}`);

    console.log('\n=== Problem Record Details (showing max 20) ===');
    for (const prob of problemRecords.slice(0, 20)) {
        console.log(`\nID: ${prob.id}`);
        console.log(`  generated_invoice_id: ${prob.invoiceId}`);
        console.log(`  Issue: ${prob.reason}`);
        if (prob.file_id) console.log(`  file_id: ${prob.file_id}`);
        if (prob.file_link_r2) console.log(`  file_link_r2: ${prob.file_link_r2}`);
        if (prob.fileKey) console.log(`  fileKey: ${prob.fileKey}`);
        if (prob.charge_to_project) console.log(`  charge_to_project: ${prob.charge_to_project}`);
    }

    // Check R2 original files directory
    console.log('\n=== Check R2 Original Files Directory ===');
    const originalPrefix = 'bui_invoice/original_files/fr_google_drive/';
    try {
        const result = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: originalPrefix,
            MaxKeys: 10
        }));
        console.log(`Original files directory (${originalPrefix}) has ${result.KeyCount || 0} files (showing first 10)`);
        for (const obj of (result.Contents || []).slice(0, 10)) {
            console.log(`  - ${obj.Key}`);
        }
    } catch (e) {
        console.error('Unable to list original files:', e.message);
    }

    // Check details of one problem record
    if (problemRecords.length > 0) {
        const sample = problemRecords.find(p => p.file_link_r2) || problemRecords[0];
        console.log('\n=== Detailed Analysis of One Problem Record ===');
        console.log('Record ID:', sample.id);
        
        // Try to extract path from file_link_r2
        if (sample.file_link_r2) {
            console.log('file_link_r2:', sample.file_link_r2);
            const urlMatch = sample.file_link_r2.match(/bui_invoice\/.*$/);
            if (urlMatch) {
                const extractedKey = urlMatch[0];
                console.log('Extracted key:', extractedKey);
                const exists = await checkFileExists(extractedKey);
                console.log('File exists:', exists);
            } else {
                console.log('Unable to extract key from URL');
            }
        }
        
        // Try to find using file_id
        if (sample.file_id) {
            console.log('file_id:', sample.file_id);
            const possibleExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
            for (const ext of possibleExtensions) {
                const testKey = `bui_invoice/original_files/fr_google_drive/${sample.file_id}${ext}`;
                const exists = await checkFileExists(testKey);
                if (exists) {
                    console.log(`Found file: ${testKey}`);
                    break;
                }
            }
        }
    }
}

main().catch(console.error);
