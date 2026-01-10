import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";
import fs from 'fs';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });
const LOCAL = 'c:/Users/LCG/.gemini/antigravity/scratch/invoice-review/bui_invoice/n8n_Test/Test_Receipt ';

function sanitize(n) { return n.replace(/:/g, '_'); }

async function check() {
    const res = await drive.files.list({
        q: "'1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3' in parents and trashed = false",
        fields: 'files(name, mimeType)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    const driveFiles = res.data.files
        .filter(f => !f.mimeType.startsWith('application/vnd.google-apps.'))
        .map(f => sanitize(f.name));

    const localFiles = fs.readdirSync(LOCAL);

    console.log('Drive files:', driveFiles.length);
    console.log('Local files:', localFiles.length);

    const missing = driveFiles.filter(f => !localFiles.includes(f));
    const extra = localFiles.filter(f => !driveFiles.includes(f));

    console.log('\nMissing locally:', missing.length > 0 ? missing : 'None');
    console.log('Extra locally:', extra.length > 0 ? extra : 'None');
}

check().catch(console.error);
