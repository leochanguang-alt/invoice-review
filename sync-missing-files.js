import 'dotenv/config';
import { google } from "googleapis";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getDriveAuth } from "./api/_sheets.js";
import { supabase } from './api/_supabase.js';

const drive = google.drive({ version: "v3", auth: getDriveAuth() });
const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "buiservice-assets";
const R2_FR_PREFIX = "bui_invoice/original_files/fr_google_drive/";
const R2_PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL || `https://${BUCKET_NAME}.r2.cloudflarestorage.com`;

function sanitizeFilename(name) {
    if (!name) return "";
    return name.replace(/[\\\/:*?"<>|]/g, '_').trim();
}

async function upsertSupabaseRecord(r2Key, etag) {
    if (!supabase) return;
    const r2Link = `${R2_PUBLIC_URL_BASE}/${r2Key}`;
    const payload = {
        file_ID_HASH_R2: etag || null,
        file_link_r2: r2Link,
        file_link: r2Link,
        status: 'Waiting for Confirm',
    };
    try {
        const { error } = await supabase
            .from('invoices')
            .upsert([payload], { onConflict: 'file_ID_HASH_R2' });
        if (error) console.warn(`[UPSERT] failed for ${r2Key}:`, error.message);
    } catch (e) {
        console.warn(`[UPSERT] exception for ${r2Key}:`, e.message);
    }
}

async function syncMissingFiles() {
    console.log('=== Sync Missing Files to R2 ===\n');

    // 1. Find records with missing R2 link
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, file_link_r2')
        .is('file_link_r2', null);

    if (error) { console.error('Error:', error.message); return; }

    console.log(`Found ${invoices.length} invoices missing R2 links.`);

    for (const invoice of invoices) {
        const driveId = invoice.file_id;

        if (!driveId || driveId.length < 5) {
            console.log(`[${invoice.id}] Skip: Invalid file_id "${driveId}"`);
            continue;
        }

        try {
            console.log(`[${invoice.id}] Fetching from Drive: ${driveId}`);

            // Get Metadata
            const fileInfo = await drive.files.get({
                fileId: driveId,
                fields: 'name, mimeType',
                supportsAllDrives: true
            });
            const originalName = fileInfo.data.name;
            const mimeType = fileInfo.data.mimeType;

            // Skip Folders
            if (mimeType === 'application/vnd.google-apps.folder') {
                console.log(`[${invoice.id}] Skip: Is a Folder`);
                continue;
            }

            // Download Stream
            const response = await drive.files.get(
                { fileId: driveId, alt: "media" },
                { responseType: "stream" }
            );

            // Upload
            const r2Key = `${R2_FR_PREFIX}${sanitizeFilename(originalName)}`;

            // Skip if already exists
            try {
                await r2.send(new HeadObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: r2Key
                }));
                console.log(`[${invoice.id}] Skip existing in R2: ${r2Key}`);
                continue;
            } catch (e) {
                // proceed if not found
            }

            const upload = new Upload({
                client: r2,
                params: {
                    Bucket: BUCKET_NAME,
                    Key: r2Key,
                    Body: response.data,
                    ContentType: mimeType,
                },
            });

            const res = await upload.done();
            const etag = res.ETag?.replace(/['"]/g, '') || null;
            const r2Url = `${R2_PUBLIC_URL_BASE}/${r2Key}`;

            console.log(`[${invoice.id}] Upload Success. ETag: ${etag}`);

            // Update DB
            const { error: upErr } = await supabase
                .from('invoices')
                .update({
                    file_link_r2: r2Url,
                    file_ID_HASH_R2: etag
                })
                .eq('id', invoice.id);

            if (upErr) console.error(`[${invoice.id}] DB Update Error:`, upErr.message);

            await upsertSupabaseRecord(r2Key, etag);

        } catch (err) {
            console.error(`[${invoice.id}] Processing Error:`, err.message);
        }
    }
    console.log('\nDone.');
}

syncMissingFiles().catch(console.error);
