/**
 * Check and fix missing project folders (R2 and Supabase drive_folder_link)
 * Usage: node fix-missing-project-folders.js
 */
import 'dotenv/config';
import { supabase } from './lib/_supabase.js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

async function checkR2FolderExists(folderPath) {
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${folderPath}.placeholder`,
        }));
        return true;
    } catch {
        return false;
    }
}

async function createR2Folder(projectCode) {
    const folderPath = `bui_invoice/projects/${projectCode}/.placeholder`;
    try {
        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: folderPath,
            Body: '',
            ContentType: 'text/plain'
        }));
        return `${R2_PUBLIC_URL}/${BUCKET_NAME}/bui_invoice/projects/${projectCode}/`;
    } catch (err) {
        console.error(`  R2 creation failed: ${err.message}`);
        return null;
    }
}

async function main() {
    if (!supabase) {
        console.error('Supabase not initialized.');
        process.exit(1);
    }

    console.log('=== Check Project Folders ===\n');

    const { data: projects, error } = await supabase
        .from('projects')
        .select('id, project_id, project_code, project_name, drive_folder_link')
        .order('project_code');

    if (error) {
        console.error('Query failed:', error.message);
        process.exit(1);
    }

    if (!projects || projects.length === 0) {
        console.log('No projects found.');
        return;
    }

    console.log(`Found ${projects.length} projects.\n`);

    let fixed = 0;
    let skipped = 0;
    let errors = 0;

    for (const project of projects) {
        const projectCode = (project.project_code || '').trim();
        const projectName = (project.project_name || '').trim();
        const existingLink = (project.drive_folder_link || '').trim();

        if (!projectCode && !projectName) {
            console.log(`[${project.id}] ⚠️  Skip: both project_code and project_name are empty`);
            skipped++;
            continue;
        }

        const folderName = projectCode || projectName || 'Unknown_Project';
        const folderPath = `bui_invoice/projects/${folderName}`;
        const expectedLink = `${R2_PUBLIC_URL}/${BUCKET_NAME}/${folderPath}/`;

        const exists = await checkR2FolderExists(folderPath);
        const needsLink = !existingLink || existingLink !== expectedLink;

        if (exists && !needsLink) {
            console.log(`[${project.id}] ✅ ${folderName} - Folder and link already exist`);
            continue;
        }

        console.log(`[${project.id}] 🔧 ${folderName}`);
        if (!exists) {
            console.log(`  Creating R2 folder: ${folderPath}`);
            const link = await createR2Folder(folderName);
            if (link) {
                console.log(`  ✅ R2 folder created`);
            } else {
                console.log(`  ❌ R2 folder creation failed`);
                errors++;
                continue;
            }
        }

        if (needsLink) {
            console.log(`  Updating drive_folder_link`);
            const { error: updateErr } = await supabase
                .from('projects')
                .update({ drive_folder_link: expectedLink })
                .eq('id', project.id);

            if (updateErr) {
                console.error(`  ❌ Update failed: ${updateErr.message}`);
                errors++;
            } else {
                console.log(`  ✅ Link updated: ${expectedLink}`);
                fixed++;
            }
        }
    }

    console.log(`\n=== Complete ===`);
    console.log(`Fixed: ${fixed}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
