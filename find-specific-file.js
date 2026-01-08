import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth } from './api/_sheets.js';

async function findFile() {
    console.log('Searching for TicketDetails.pdf...');
    const auth = getDriveAuth();
    const drive = google.drive({ version: 'v3', auth });

    try {
        const res = await drive.files.list({
            q: "name = 'TicketDetails.pdf' and trashed = false",
            fields: 'files(id, name, mimeType, parents, webViewLink)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        console.log('Found:', JSON.stringify(res.data.files, null, 2));
    } catch (e) {
        console.error('Search failed:', e);
    }
}

findFile();
