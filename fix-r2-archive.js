/**
 * Fix R2 file archiving for submitted records
 * Copy original files to project folders and update database
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { S3Client, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';

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
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://pub-fba568bc6d17420e8f9b16cf9c31a2e5.r2.dev`;
const R2_PROJECTS_PREFIX = 'bui_invoice/projects';

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

async function copyFile(sourceKey, targetKey) {
    // URL encode the source path for CopySource (required by S3/R2 for special characters)
    const encodedSourceKey = sourceKey.split('/').map(part => encodeURIComponent(part)).join('/');
    
    await r2.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${encodedSourceKey}`,
        Key: targetKey
    }));
}

async function main() {
    console.log('=== Fix R2 File Archiving ===\n');

    // Get all records that need fixing (submitted but no achieved_file_link)
    const { data: records, error } = await supabase
        .from('invoices')
        .select('id, generated_invoice_id, file_id, file_link_r2, achieved_file_link, achieved_file_id, charge_to_project')
        .eq('status', 'Submitted')
        .is('achieved_file_link', null)
        .not('charge_to_project', 'is', null)
        .order('id', { ascending: false });

    if (error) {
        console.error('Failed to get records:', error.message);
        return;
    }

    console.log(`Found ${records.length} records that need fixing\n`);

    // Get project mapping (by project_code)
    const { data: projects } = await supabase
        .from('projects')
        .select('id, project_code, project_name');
    
    // Create multiple mapping methods: by id, by code, by name
    const projectByIdMap = new Map();
    const projectByCodeMap = new Map();
    const projectByNameMap = new Map();
    for (const p of projects || []) {
        projectByIdMap.set(p.id, p.project_code);
        projectByCodeMap.set(p.project_code, p.project_code);
        if (p.project_name) {
            projectByNameMap.set(p.project_name, p.project_code);
        }
    }

    let successCount = 0;
    let failCount = 0;

    for (const record of records) {
        const { id, generated_invoice_id, file_id, file_link_r2, charge_to_project } = record;
        
        // charge_to_project could be project ID, project code or project name
        let projectCode = null;
        if (typeof charge_to_project === 'number') {
            projectCode = projectByIdMap.get(charge_to_project);
        } else if (typeof charge_to_project === 'string') {
            // Try to find by code
            projectCode = projectByCodeMap.get(charge_to_project);
            // If not found, try to find by name
            if (!projectCode) {
                projectCode = projectByNameMap.get(charge_to_project);
            }
            // If still not found, use charge_to_project as code directly
            if (!projectCode) {
                projectCode = charge_to_project;
            }
        }
        
        if (!projectCode) {
            console.log(`[Skip] ID ${id}: Cannot find project code (charge_to_project: ${charge_to_project})`);
            failCount++;
            continue;
        }

        if (!generated_invoice_id) {
            console.log(`[Skip] ID ${id}: No generated_invoice_id`);
            failCount++;
            continue;
        }

        // Extract original file path from file_link_r2
        let originalKey = null;
        let fileExtension = '.pdf';

        if (file_link_r2) {
            // Handle URL encoding
            let decodedLink = file_link_r2;
            try {
                decodedLink = decodeURIComponent(file_link_r2);
            } catch (e) {
                // ignore
            }
            
            const urlMatch = decodedLink.match(/bui_invoice\/.*$/);
            if (urlMatch) {
                originalKey = urlMatch[0];
                const parts = originalKey.split('.');
                if (parts.length > 1) {
                    fileExtension = '.' + parts[parts.length - 1];
                }
            }
        }

        if (!originalKey) {
            console.log(`[Skip] ID ${id}: Cannot extract original file path`);
            failCount++;
            continue;
        }

        // Check if original file exists
        const exists = await checkFileExists(originalKey);
        if (!exists) {
            console.log(`[Skip] ID ${id}: Original file does not exist (${originalKey})`);
            failCount++;
            continue;
        }

        // Target path
        const targetKey = `${R2_PROJECTS_PREFIX}/${projectCode}/${generated_invoice_id}${fileExtension}`;
        
        // Check if target file already exists
        const targetExists = await checkFileExists(targetKey);
        if (targetExists) {
            // File already exists, only need to update database
            console.log(`[Exists] ID ${id}: ${targetKey}`);
        } else {
            // Copy file
            try {
                await copyFile(originalKey, targetKey);
                console.log(`[Copy success] ID ${id}: ${originalKey} -> ${targetKey}`);
            } catch (copyErr) {
                console.error(`[Copy failed] ID ${id}: ${copyErr.message}`);
                failCount++;
                continue;
            }
        }

        // Update database
        const archivedLink = `${R2_PUBLIC_URL}/${targetKey}`;
        const { error: updateErr } = await supabase
            .from('invoices')
            .update({
                achieved_file_link: archivedLink,
                achieved_file_id: targetKey
            })
            .eq('id', id);

        if (updateErr) {
            console.error(`[Update failed] ID ${id}: ${updateErr.message}`);
            failCount++;
        } else {
            console.log(`[Update success] ID ${id}: achieved_file_link = ${archivedLink}`);
            successCount++;
        }
    }

    console.log(`\n=== Complete ===`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);
}

main().catch(console.error);
