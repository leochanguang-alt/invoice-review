import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { getSheetsClient, SHEET_ID, MAIN_SHEET, getDriveAuth } from './api/_sheets.js';
import { google } from "googleapis";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import crypto from 'crypto';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";

const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";

async function verify() {
    console.log("=== FULL SYSTEM VERIFICATION ===\n");

    try {
        // 1. SUPABASE
        console.log("1. Checking Supabase...");
        const { data: dbRecords, error: dbError } = await supabase
            .from('invoices')
            .select('*');
        if (dbError) throw dbError;
        console.log(`   - Supabase Records: ${dbRecords.length}`);

        // 2. GOOGLE SHEETS
        console.log("\n2. Checking Google Sheets...");
        const sheets = getSheetsClient();

        // Get metadata to find real sheet name
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const sheetNames = meta.data.sheets.map(s => s.properties.title);
        console.log(`   - Available Sheets: ${sheetNames.join(', ')}`);

        let targetSheet = MAIN_SHEET;
        if (!sheetNames.includes(targetSheet)) {
            console.log(`   - Warning: configured sheet '${targetSheet}' not found. Using '${sheetNames[0]}'`);
            targetSheet = sheetNames[0];
        }

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${targetSheet}!A2:L`,
        });
        const sheetRows = res.data.values || [];
        console.log(`   - Sheet Rows: ${sheetRows.length}`);

        // 3. COMPARE DATA
        console.log("\n3. Comparing Supabase vs Sheets...");
        console.log(`   - Count Difference: ${dbRecords.length - sheetRows.length}`);

        // 4. GOOGLE DRIVE
        console.log("\n4. Checking Google Drive (Test_invoice)...");
        const driveFiles = [];
        let pageToken = null;
        do {
            const dRes = await drive.files.list({
                q: `'${TEST_INVOICE_FOLDER_ID}' in parents and trashed = false`,
                fields: "nextPageToken, files(id, name, mimeType)",
                pageToken: pageToken,
            });
            dRes.data.files.forEach(f => {
                if (!f.mimeType.startsWith('application/vnd.google-apps.')) {
                    driveFiles.push(f.name);
                }
            });
            pageToken = dRes.data.nextPageToken;
        } while (pageToken);
        console.log(`   - Drive Files (Downloadable): ${driveFiles.length}`);

        // 5. R2
        console.log("\n5. Checking R2 (fr_google_drive)...");
        const r2Files = [];
        let r2Token = null;
        do {
            const r2Res = await r2.send(new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: 'bui_invoice/original_files/fr_google_drive/',
                ContinuationToken: r2Token
            }));
            (r2Res.Contents || []).forEach(o => {
                r2Files.push(o.Key.split('/').pop());
            });
            r2Token = r2Res.NextContinuationToken;
        } while (r2Token);
        console.log(`   - R2 Files: ${r2Files.length}`);

        // 6. COMPARE FILES
        console.log("\n6. Comparing Drive vs R2...");
        const driveSet = new Set(driveFiles);
        const r2Set = new Set(r2Files);

        const missingInR2 = driveFiles.filter(x => !r2Set.has(x));
        const extraInR2 = r2Files.filter(x => !driveSet.has(x));

        console.log(`   - Missing in R2: ${missingInR2.length}`);
        if (missingInR2.length > 0) console.log("     " + missingInR2.slice(0, 3).join(", "));

        console.log(`   - Extra in R2: ${extraInR2.length}`);
        if (extraInR2.length > 0) console.log("     " + extraInR2.slice(0, 3).join(", "));

    } catch (err) {
        console.error("Verification failed:", err);
    }
}

verify();
