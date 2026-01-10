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
const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8'; // Google Drive archive folder

// List all files in R2 projects folder
async function listR2ProjectFiles() {
    const files = [];
    let token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: 'bui_invoice/projects/',
            ContinuationToken: token
        }));
        for (const obj of res.Contents || []) {
            const parts = obj.Key.split('/');
            if (parts.length >= 4) {
                files.push({
                    key: obj.Key,
                    project: parts[2], // e.g., BUI-2512
                    filename: parts[3], // e.g., BUI-2512-0001
                });
            }
        }
        token = res.IsTruncated ? res.NextContinuationToken : null;
    } while (token);
    return files;
}

// List all files in Google Drive archive folder (project folders)
async function listDriveArchiveFiles() {
    const files = [];

    // First get all project folders
    let pageToken = null;
    const folders = [];
    do {
        const res = await drive.files.list({
            q: `'${ARCHIVE_PARENT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id, name)',
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        folders.push(...(res.data.files || []));
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    console.log(`   Found ${folders.length} project folders in Drive`);

    // Then get files in each folder
    for (const folder of folders) {
        let fileToken = null;
        do {
            const res = await drive.files.list({
                q: `'${folder.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
                fields: 'nextPageToken, files(id, name)',
                pageToken: fileToken,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });
            for (const file of res.data.files || []) {
                files.push({
                    project: folder.name,
                    filename: file.name,
                    driveId: file.id
                });
            }
            fileToken = res.data.nextPageToken;
        } while (fileToken);
    }

    return files;
}

async function compare() {
    console.log('=== Compare R2 Projects vs Google Drive Archive ===\n');

    // 1. List R2 projects
    console.log('1. Listing R2 projects files...');
    const r2Files = await listR2ProjectFiles();
    console.log(`   Found ${r2Files.length} files in R2 projects`);

    // 2. List Drive archive
    console.log('\n2. Listing Google Drive archive files...');
    const driveFiles = await listDriveArchiveFiles();
    console.log(`   Found ${driveFiles.length} files in Drive archive`);

    // 3. Group by project
    const r2ByProject = {};
    for (const f of r2Files) {
        r2ByProject[f.project] = (r2ByProject[f.project] || 0) + 1;
    }

    const driveByProject = {};
    for (const f of driveFiles) {
        driveByProject[f.project] = (driveByProject[f.project] || 0) + 1;
    }

    // 4. Compare
    console.log('\n3. Comparison by project:');
    const allProjects = new Set([...Object.keys(r2ByProject), ...Object.keys(driveByProject)]);

    let totalR2 = 0, totalDrive = 0, matchCount = 0;

    for (const project of [...allProjects].sort()) {
        const r2Count = r2ByProject[project] || 0;
        const driveCount = driveByProject[project] || 0;
        totalR2 += r2Count;
        totalDrive += driveCount;

        const status = r2Count === driveCount ? '✅' : '❌';
        if (r2Count !== driveCount) {
            console.log(`   ${project}: R2=${r2Count}, Drive=${driveCount} ${status}`);
        } else {
            matchCount++;
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log('COMPARISON COMPLETE');
    console.log('='.repeat(50));
    console.log(`R2 projects total: ${totalR2}`);
    console.log(`Google Drive archive total: ${totalDrive}`);
    console.log(`Projects matching: ${matchCount}/${allProjects.size}`);
    console.log(`\nOverall match: ${totalR2 === totalDrive ? '✅ YES' : '❌ NO'}`);
}

compare().catch(console.error);
