import 'dotenv/config';
import { google } from "googleapis";
import { S3Client } from "@aws-sdk/client-s3";
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

function extractDriveId(fileLink) {
    if (!fileLink) return null;
    let match = fileLink.match(/id=([^&]+)/);
    if (match) return match[1];
    match = fileLink.match(/\/d\/([^\/]+)/);
    if (match) return match[1];
    return null;
}

function sanitizeFilename(name) {
    return name.replace(/:/g, '_');
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

        } catch (err) {
            console.error(`[${invoice.id}] Error: ${err.message}`);
        }
    }
    console.log('\nDone.');
}

syncWaitingInvoices().catch(console.error);
