import 'dotenv/config';
import { google } from 'googleapis';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getDriveAuth } from './api/_sheets.js';

const drive = google.drive({ version: 'v3', auth: getDriveAuth() });

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';

async function findMissingFile() {
    console.log('=== Finding Missing File in BUI-2512 ===\n');

    // 1. Get R2 BUI-2512 files
    console.log('1. Listing R2 BUI-2512 files...');
    const r2Files = [];
    let token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: 'bui_invoice/projects/BUI-2512/',
            ContinuationToken: token
        }));
        for (const obj of res.Contents || []) {
            r2Files.push(obj.Key.split('/').pop());
        }
        token = res.IsTruncated ? res.NextContinuationToken : null;
    } while (token);
    console.log(`   Found ${r2Files.length} files`);

    // 2. Get Drive BUI-2512 folder
    console.log('\n2. Listing Drive BUI-2512 files...');
    const foldersRes = await drive.files.list({
        q: `'${ARCHIVE_PARENT_ID}' in parents and name = 'BUI-2512' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    const folder = foldersRes.data.files?.[0];
    if (!folder) {
        console.log('   Folder not found!');
        return;
    }

    const driveFiles = [];
    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folder.id}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name)',
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        for (const file of res.data.files || []) {
            driveFiles.push(file.name);
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    console.log(`   Found ${driveFiles.length} files`);

    // 3. Find files in Drive but not in R2
    const r2Set = new Set(r2Files);
    const missingInR2 = driveFiles.filter(f => !r2Set.has(f));

    console.log('\n3. Files in Drive but NOT in R2:');
    missingInR2.forEach(f => console.log(`   - ${f}`));

    // 4. Find files in R2 but not in Drive
    const driveSet = new Set(driveFiles);
    const missingInDrive = r2Files.filter(f => !driveSet.has(f));

    console.log('\n4. Files in R2 but NOT in Drive:');
    missingInDrive.forEach(f => console.log(`   - ${f}`));
}

findMissingFile().catch(console.error);
