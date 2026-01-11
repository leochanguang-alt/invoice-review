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

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_FR_PREFIX = "bui_invoice/original_files/fr_google_drive/";
const R2_BASE_URL = `https://${BUCKET_NAME}.r2.cloudflarestorage.com/`;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || R2_BASE_URL;

function extractDriveId(fileLink) {
    if (!fileLink) return null;
    let match = fileLink.match(/id=([^&]+)/);
    if (match) return match[1];
    match = fileLink.match(/\/d\/([^\/]+)/);
    if (match) return match[1];
    return null;
}

function sanitizeFilename(name) {
    if (!name) return "";
    return name.replace(/[\\\/:*?"<>|]/g, '_').trim();
}

async function upsertSupabaseRecord(r2Key, etag) {
    if (!supabase) return;
    const r2Link = `${R2_PUBLIC_URL}${r2Key}`;
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

async function syncWaitingInvoices() {
    console.log('=== Sync Waiting for Confirm Invoices to R2 ===\n');

    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, file_id, file_link, vendor')
        .eq('status', 'Waiting for Confirm');

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log(`Found ${invoices.length} invoices to process.`);

    for (const invoice of invoices) {
        let driveId = invoice.file_id;
        if ((!driveId || driveId.length < 15) && invoice.file_link) {
            driveId = extractDriveId(invoice.file_link);
        }

        if (!driveId) {
            console.log(`[${invoice.id}] Skip: No drive ID`);
            continue;
        }

        try {
            console.log(`[${invoice.id}] Fetching from Drive: ${driveId}`);
            const fileInfo = await drive.files.get({
                fileId: driveId,
                fields: 'name, mimeType',
                supportsAllDrives: true
            });

            const originalName = fileInfo.data.name;
            const sanitizedName = sanitizeFilename(originalName);
            const mimeType = fileInfo.data.mimeType;

            const response = await drive.files.get(
                { fileId: driveId, alt: "media" },
                { responseType: "stream" }
            );

            const r2Key = `${R2_FR_PREFIX}${sanitizedName}`;

            // Skip if already exists
            try {
                await r2.send(new HeadObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: r2Key,
                }));
                console.log(`[${invoice.id}] Skip existing in R2: ${r2Key}`);
                continue;
            } catch (e) {
                // proceed if not found
            }

            console.log(`[${invoice.id}] Uploading to R2: ${r2Key}`);

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
            const etag = res.ETag?.replace(/"/g, '') || null;
            const r2Url = `${R2_BASE_URL}${r2Key}`;

            console.log(`[${invoice.id}] Updating Supabase: hash=${etag}`);
            await supabase
                .from('invoices')
                .update({
                    file_ID_HASH: etag,
                    file_link: r2Url
                })
                .eq('id', invoice.id);

            await upsertSupabaseRecord(r2Key, etag);
        } catch (err) {
            console.error(`[${invoice.id}] Error: ${err.message}`);
        }
    }
    console.log('\nDone.');
}

syncWaitingInvoices().catch(console.error);
