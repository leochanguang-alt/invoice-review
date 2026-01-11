import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth } from './api/_sheets.js';

const auth = getDriveAuth();
const drive = google.drive({ version: 'v3', auth });

async function checkFolder() {
    const folderId = '1u9LB4n6RjW3WscsT-G5_mYcveH2n8I9f';
    let files = [];
    let pageToken = null;

    console.log(`Checking folder ${folderId}...`);
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageToken: pageToken
        });
        files = files.concat(res.data.files);
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    console.log(`Total files in Test_invoice (${folderId}):`, files.length);
    if (files.length > 0) {
        console.log('Sample files:', files.slice(0, 5).map(f => f.name));
    }
}

checkFolder().catch(console.error);
