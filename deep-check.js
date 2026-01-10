import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';
import path from 'path';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });
const LOCAL = 'c:/Users/LCG/.gemini/antigravity/scratch/invoice-review/bui_invoice/n8n_Test/Test_Receipt ';
const FOLDER_ID = '1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3';

function sanitize(n) { return n.replace(/:/g, '_'); }

async function listDriveRecursive(folderId, prefix = '') {
    const files = [];
    const folders = [];
    let pageToken = null;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        for (const file of res.data.files) {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
                folders.push({ name: file.name, id: file.id, path: prefix + file.name });
                const sub = await listDriveRecursive(file.id, prefix + file.name + '/');
                files.push(...sub.files);
                folders.push(...sub.folders);
            } else if (!file.mimeType.startsWith('application/vnd.google-apps.')) {
                files.push(prefix + file.name);
            }
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return { files, folders };
}

function listLocalRecursive(dir, prefix = '') {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const sub = listLocalRecursive(path.join(dir, entry.name), prefix + entry.name + '/');
            files.push(...sub);
        } else {
            files.push(prefix + entry.name);
        }
    }

    return files;
}

async function deepCheck() {
    console.log('=== Deep Check: Drive vs Local (including subfolders) ===\n');

    const driveResult = await listDriveRecursive(FOLDER_ID);
    const driveFiles = driveResult.files.map(f => sanitize(f)).sort();

    console.log('Google Drive folders:', driveResult.folders.length > 0 ? driveResult.folders.map(f => f.path) : 'None');
    console.log('Google Drive files:', driveFiles.length);

    const localFiles = listLocalRecursive(LOCAL).sort();
    console.log('Local files:', localFiles.length);

    const missing = driveFiles.filter(f => !localFiles.includes(f));
    const extra = localFiles.filter(f => !driveFiles.includes(f));

    console.log('\nMissing locally:', missing.length > 0 ? missing : 'None');
    console.log('\nExtra locally:', extra.length > 0 ? extra : 'None');

    if (missing.length === 0 && extra.length === 0) {
        console.log('\n✅ Perfect match!');
    }
}

deepCheck().catch(console.error);
