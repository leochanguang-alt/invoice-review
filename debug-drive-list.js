import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth } from './api/_sheets.js';

async function listFilesVerbose() {
    const FOLDER_ID = '1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3';
    console.log(`--- Listing Files in ${FOLDER_ID} ---`);

    const auth = getDriveAuth();
    const drive = google.drive({ version: 'v3', auth });

    try {
        const res = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const files = res.data.files || [];
        console.log(`Found ${files.length} files.`);

        files.forEach(f => {
            console.log(`[${f.name}] ID: [${f.id}] (${f.mimeType})`);
        });
    } catch (e) {
        console.error('List failed:', e);
    }
}

listFilesVerbose();
