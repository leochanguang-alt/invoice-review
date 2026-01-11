import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth } from './api/_sheets.js';

const drive = google.drive({ version: 'v3', auth: getDriveAuth() });
const FOLDER_ID = '1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3';

async function checkDups() {
    console.log("Checking for duplicates in Drive...");
    const files = [];
    let token;

    do {
        const res = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageToken: token
        });

        res.data.files.forEach(f => {
            if (!f.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push(f.name);
            }
        });
        token = res.data.nextPageToken;
    } while (token);

    const seen = new Set();
    const dups = [];
    files.forEach(f => {
        if (seen.has(f)) dups.push(f);
        seen.add(f);
    });

    console.log('Total Downloadable Files:', files.length);
    console.log('Unique Filenames:', seen.size);
    if (dups.length > 0) {
        console.log('Duplicate Names:', dups);
    } else {
        console.log('No duplicates found.');
    }
}

checkDups().catch(console.error);
