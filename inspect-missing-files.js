import 'dotenv/config';
import { google } from "googleapis";
import { getDriveAuth } from "./api/_sheets.js";

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

async function inspectFiles() {
    const fileNames = ["Invoice.n8n.test", "Bank_Statement"];

    for (const name of fileNames) {
        console.log(`\nInspecting: ${name}`);
        const res = await drive.files.list({
            q: `name = '${name}' and trashed = false`,
            fields: "files(id, name, mimeType, size, kind)",
        });

        if (res.data.files.length === 0) {
            console.log(`File not found: ${name}`);
        } else {
            res.data.files.forEach(f => {
                console.log(` - ID: ${f.id}`);
                console.log(` - MimeType: ${f.mimeType}`);
                console.log(` - Size: ${f.size || 'unknown'}`);
            });
        }
    }
}

inspectFiles().catch(console.error);
