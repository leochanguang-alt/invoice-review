import 'dotenv/config';
import { supabase } from './api/_supabase.js';
import { getDriveAuth } from './api/_sheets.js';
import { google } from "googleapis";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

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
const R2_PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL || `https://${BUCKET_NAME}.r2.cloudflarestorage.com`;
const TEST_INVOICE_FOLDER_ID = "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3"; // From verified script

async function correctAllData() {
    console.log("=== STARTING FULL DATA CORRECTION ===");

    // 1. Fetch R2 Files (Map by Filename AND ETag)
    console.log("1. Fetching R2 Files...");
    const r2Map = new Map(); // Filename -> { key, etag, url }
    const r2EtagMap = new Map(); // ETag -> { key, etag, url }
    let r2Token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: 'bui_invoice/original_files/fr_google_drive/',
            ContinuationToken: r2Token
        }));
        (res.Contents || []).forEach(o => {
            const filename = o.Key.split('/').pop();
            const etag = o.ETag?.replace(/['"]/g, ''); // Clean ETag
            const fileObj = {
                key: o.Key,
                etag: etag,
                url: `${R2_PUBLIC_URL_BASE}/${o.Key}`
            };
            r2Map.set(filename, fileObj);
            if (etag) r2EtagMap.set(etag, fileObj);
        });
        r2Token = res.NextContinuationToken;
    } while (r2Token);
    console.log(`   Indexed ${r2Map.size} R2 files.`);

    // 2. Fetch Google Drive Files (Map by Filename)
    console.log("2. Fetching Google Drive Files...");
    const driveMap = new Map(); // Filename -> { id, webViewLink, name }
    const driveIdMap = new Map(); // ID -> { id, webViewLink, name } (Inverse lookup)
    let driveToken = null;
    do {
        const res = await drive.files.list({
            q: `'${TEST_INVOICE_FOLDER_ID}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, webViewLink)",
            pageToken: driveToken,
            pageSize: 1000
        });
        res.data.files.forEach(f => {
            driveMap.set(f.name, f);
            driveIdMap.set(f.id, f);
        });
        driveToken = res.data.nextPageToken;
    } while (driveToken);
    console.log(`   Indexed ${driveMap.size} Drive files.`);

    // 3. Fetch All Invoices
    console.log("3. Fetching DB Records...");
    const { data: invoices, error } = await supabase.from('invoices').select('*');
    if (error) { console.error("DB Error:", error); return; }
    console.log(`   Loaded ${invoices.length} records.`);

    // 4. Process & Update
    console.log("4. Processing Records...");
    let updatedCount = 0;

    for (const inv of invoices) {
        let updates = {};

        // --- Strategy: Identify Filename ---
        let filename = null;
        let driveFile = null;
        let r2File = null;

        // A. Try to find via existing Google Drive ID (file_id)
        if (inv.file_id && driveIdMap.has(inv.file_id)) {
            driveFile = driveIdMap.get(inv.file_id);
            filename = driveFile.name;
        }

        // B. If not found, try to extract filename from R2 links
        if (!filename) {
            const link = inv.file_link_r2 || inv.file_link || '';

            // Special Case: Google Drive Link extraction
            if (link.includes('drive.google.com')) {
                // Try to find ID regex
                const idMatch = link.match(/\/d\/([^/]+)/);
                if (idMatch && driveIdMap.has(idMatch[1])) {
                    filename = driveIdMap.get(idMatch[1]).name;
                }
            } else {
                // R2 / Direct Link extraction
                const match = link.match(/\/([^/?]+)(\?|$)/); // Exclude query params
                if (match) {
                    const candidate = decodeURIComponent(match[1]);
                    if (candidate !== 'view' && candidate !== 'preview') {
                        filename = candidate;
                    }
                }
            }
        }

        // --- Match R2 & Drive ---

        // 1. Try matching R2 by ETag (Strongest Link if Hash exists)
        if (!r2File && inv.file_ID_HASH_R2 && r2EtagMap.has(inv.file_ID_HASH_R2)) {
            r2File = r2EtagMap.get(inv.file_ID_HASH_R2);
            // Infer filename from R2 key if missing
            if (!filename) {
                const keyParts = r2File.key.split('/');
                filename = keyParts[keyParts.length - 1];
            }
        }

        if (filename) {
            if (inv.id === 8055) console.log(`[DEBUG 8055] Filename: "${filename}"`);

            // Lookup R2 (If not already found)
            if (!r2File) {
                if (r2Map.has(filename)) {
                    r2File = r2Map.get(filename);
                } else {
                    const decoded = decodeURIComponent(filename);
                    if (r2Map.has(decoded)) r2File = r2Map.get(decoded);

                    const nfc = filename.normalize('NFC');
                    if (r2Map.has(nfc)) r2File = r2Map.get(nfc);

                    if (inv.id === 8055 && !r2File) {
                        console.log(`[DEBUG 8055] R2 strict match failed for "${filename}".`);
                    }
                }
            }

            // Lookup Drive (if not already found via ID)
            if (!driveFile && driveMap.has(filename)) {
                driveFile = driveMap.get(filename);
            }
        }

        // --- Prepare Updates ---

        // 1. R2 Updates
        if (r2File) {
            if (inv.file_link_r2 !== r2File.url) updates.file_link_r2 = r2File.url;
            if (inv.file_ID_HASH_R2 !== r2File.etag) updates.file_ID_HASH_R2 = r2File.etag;
        }

        // 2. Drive Updates
        if (driveFile) {
            // User wants file_link to satisfy Google Drive Link
            if (inv.file_link !== driveFile.webViewLink) updates.file_link = driveFile.webViewLink;
            // User wants file_id to satisfy Google Drive ID
            if (inv.file_id !== driveFile.id) updates.file_id = driveFile.id;
        }

        // Perform Update
        if (inv.id === 8055) {
            console.log(`[DEBUG 8055] Ready to update. Updates:`, JSON.stringify(updates, null, 2));
        }

        if (Object.keys(updates).length > 0) {
            const { error: upErr } = await supabase
                .from('invoices')
                .update(updates)
                .eq('id', inv.id);

            if (inv.id === 8055) {
                if (upErr) console.log(`[DEBUG 8055] UPDATE FAILED:`, upErr);
                else console.log(`[DEBUG 8055] UPDATE SUCCESS!`);
            }

            if (upErr) {
                if (upErr.code === '23505') { // Unique violation
                    // console.log(`   [SKIP] Duplicate file_id for ${inv.id}`);
                } else {
                    console.error(`Error updating ${inv.id}:`, upErr.message);
                }
            } else {
                updatedCount++;
            }
        } else if (inv.id === 8055) {
            console.log(`[DEBUG 8055] No updates needed. (DB matches found data)`);
            console.log(`DB Link R2: ${inv.file_link_r2}`);
        }
    }

    console.log(`=== COMPLETED. Updated ${updatedCount} records. ===`);
}

correctAllData().catch(console.error);
