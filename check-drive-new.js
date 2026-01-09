import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth } from './api/_sheets.js';

const drive = google.drive({ version: 'v3', auth: getDriveAuth() });

async function checkDrive() {
    console.log('Searching for Test_invoice folder ID...');
    const res = await drive.files.list({
        q: "name = 'Test_invoice' and trashed = false and mimeType = 'application/vnd.google-apps.folder'",
        fields: 'files(id, name)'
    });

    if (res.data.files.length === 0) {
        console.log('Test_invoice folder not found anywhere.');
        return;
    }

    const folderId = res.data.files[0].id;
    console.log(`Found Test_invoice (ID: ${folderId}). Listing contents...`);

    const res2 = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, modifiedTime, size)',
        orderBy: 'modifiedTime desc'
    });

    const files = res2.data.files || [];
    console.log(`\nFound ${files.length} files. Most recent:`);

    files.slice(0, 5).forEach(f => {
        console.log(` - ${f.name}`);
        console.log(`   Type: ${f.mimeType}`);
        console.log(`   Modified: ${f.modifiedTime}`);
        console.log(`   Size: ${f.size || 'N/A'}`);
        console.log(`   ID: ${f.id}`);
    });
}

checkDrive().catch(console.error);
