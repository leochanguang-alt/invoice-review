// On-demand Google Drive -> R2 -> Gemini sync, small enough to finish inside a
// serverless invocation. The scheduled GitHub Actions run still handles bulk
// catch-up; this exists so the UI can pull in a file that was just dropped in
// Drive without waiting for the next cron tick.
import { google } from "googleapis";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDriveAuth } from "./_sheets.js";
import { getCurrencyList } from "./currency-country-link.js";
import { extractInvoiceFields, isSupportedInvoiceFile, mimeTypeForFile } from "./invoice-extract.js";
import { planDriveFileSync, sanitizeDriveName } from "./drive-sync-plan.js";
import { findExistingDuplicate } from "./invoice-duplicates.js";

const DRIVE_FOLDER_ID = process.env.DRIVE_INVOICE_FOLDER_ID || "1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3";
const R2_PREFIX = "bui_invoice/original_files/fr_google_drive";

function publicUrlBase() {
    const raw = process.env.R2_PUBLIC_URL || `https://${process.env.R2_BUCKET_NAME}.r2.cloudflarestorage.com`;
    return raw.replace(/\/+$/, "");
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function listDriveFiles(drive, folderId) {
    const files = [];
    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
            fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
            orderBy: "modifiedTime desc",
            pageSize: 200,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        files.push(...(res.data.files || []));
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return files;
}

// One listing beats a HeadObject per Drive file; with a few hundred invoices
// the per-file probes alone used up most of the serverless time budget.
async function indexR2Objects(r2, bucket, driveIds) {
    const suffixes = new Map();
    for (const id of driveIds) suffixes.set(String(id).slice(0, 8), id);

    const byKey = new Map();
    const ownedByDriveId = new Map();
    let token = null;
    do {
        const res = await r2.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: `${R2_PREFIX}/`,
            ContinuationToken: token,
        }));
        for (const obj of res.Contents || []) {
            const entry = { key: obj.Key, size: obj.Size, lastModified: obj.LastModified };
            byKey.set(obj.Key, entry);

            const match = obj.Key.match(/\(([A-Za-z0-9_-]{8})\)(\.[^.]+)?$/);
            if (!match) continue;
            const driveId = suffixes.get(match[1]);
            if (driveId) ownedByDriveId.set(driveId, entry);
        }
        token = res.IsTruncated ? res.NextContinuationToken : null;
    } while (token);
    return { byKey, ownedByDriveId };
}

async function findStoredDuplicate(supabase, fields) {
    if (!fields.invoice_date || !fields.vendor) return null;
    const { data } = await supabase
        .from("invoices")
        .select("id,vendor,amount,currency,invoice_date,invoice_number,status,generated_invoice_id")
        .eq("invoice_date", fields.invoice_date)
        .is("deleted_at", null);
    return findExistingDuplicate(fields, data || []);
}

/**
 * @param {object} deps
 * @param {import('@supabase/supabase-js').SupabaseClient} deps.supabase
 * @param {object} options
 * @param {number} options.maxFiles     hard cap on files parsed in one call
 * @param {number} options.budgetMs     stop starting new work after this long
 * @param {number} options.lookbackDays ignore Drive files older than this
 */
export async function runDriveSync({ supabase }, { maxFiles = 5, budgetMs = 45000, lookbackDays = 90 } = {}) {
    const started = Date.now();
    const timeLeft = () => budgetMs - (Date.now() - started);

    if (!supabase) throw new Error("Supabase client is not initialized");
    if (!process.env.R2_ENDPOINT || !process.env.R2_BUCKET_NAME) throw new Error("R2 is not configured");
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const bucket = process.env.R2_BUCKET_NAME;
    const r2 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    const drive = google.drive({ version: "v3", auth: getDriveAuth() });
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);

    const driveFiles = (await listDriveFiles(drive, DRIVE_FOLDER_ID))
        .filter(f => isSupportedInvoiceFile(f.name))
        .filter(f => !f.modifiedTime || new Date(f.modifiedTime) >= cutoff);

    const driveIds = driveFiles.map(f => f.id);
    const { data: rows } = await supabase
        .from("invoices")
        .select("id,status,vendor,amount,file_id,file_link_r2,file_ID_HASH_R2,deleted_at,charge_to_project,generated_invoice_id")
        .in("file_id", driveIds.slice(0, 500));
    const recordByDriveId = new Map((rows || []).map(r => [r.file_id, r]));

    const { byKey, ownedByDriveId } = await indexR2Objects(r2, bucket, driveIds);
    const currencyList = await getCurrencyList(supabase);
    const urlBase = publicUrlBase();

    const processed = [];
    const skipped = [];
    const duplicates = [];
    const failed = [];
    let pending = 0;

    for (const file of driveFiles) {
        const record = recordByDriveId.get(file.id) || null;
        const plan = planDriveFileSync({
            driveFile: file,
            ownedKey: ownedByDriveId.get(file.id) || null,
            namedKey: byKey.get(`${R2_PREFIX}/${sanitizeDriveName(file.name)}`) || null,
            record,
            prefix: R2_PREFIX,
        });

        if (plan.action === "skip" || plan.action === "adopt") {
            skipped.push({ name: file.name, reason: plan.reason });
            continue;
        }

        // A record that is already reviewed must keep its extracted fields, so
        // refresh the file pointer only.
        if ((plan.action === "replace" || plan.action === "upload") && record && !plan.reparse) {
            skipped.push({ name: file.name, reason: "already reviewed; not reparsed" });
            continue;
        }

        if (processed.length >= maxFiles || timeLeft() < 12000) {
            pending++;
            continue;
        }

        try {
            const driveRes = await drive.files.get(
                { fileId: file.id, alt: "media" },
                { responseType: "stream" },
            );
            const bytes = await streamToBuffer(driveRes.data);

            const upload = new Upload({
                client: r2,
                params: {
                    Bucket: bucket,
                    Key: plan.key,
                    Body: bytes,
                    ContentType: file.mimeType || mimeTypeForFile(file.name),
                    Metadata: { driveid: String(file.id) },
                },
            });
            const uploadResult = await upload.done();
            const etag = uploadResult.ETag?.replace(/"/g, "") || null;

            const { fields } = await extractInvoiceFields(genAI, {
                bytes,
                mimeType: mimeTypeForFile(file.name),
                currencyList,
            });

            const payload = {
                ...fields,
                file_ID_HASH_R2: etag,
                file_link_r2: `${urlBase}/${plan.key}`,
                file_link: `https://drive.google.com/file/d/${file.id}/view`,
                file_id: file.id,
                status: "Waiting for Confirm",
            };

            if (record) {
                const { error } = await supabase.from("invoices").update(payload).eq("id", record.id);
                if (error) throw new Error(error.message);
                processed.push({ name: file.name, id: record.id, mode: "updated", vendor: fields.vendor, amount: fields.amount, currency: fields.currency });
                continue;
            }

            // Drive often holds the same receipt twice under one name. The R2
            // object stays uploaded so the next sync skips it without paying
            // for another extraction.
            const twin = await findStoredDuplicate(supabase, fields);
            if (twin) {
                duplicates.push({ name: file.name, existingId: twin.id, vendor: fields.vendor, amount: fields.amount, currency: fields.currency });
                continue;
            }

            const { data: inserted, error } = await supabase.from("invoices").insert([payload]).select("id");
            if (error) throw new Error(error.message);
            processed.push({ name: file.name, id: inserted?.[0]?.id, mode: "created", vendor: fields.vendor, amount: fields.amount, currency: fields.currency });
        } catch (err) {
            failed.push({ name: file.name, error: err?.message || String(err) });
        }
    }

    return {
        scanned: driveFiles.length,
        processed,
        duplicates,
        skippedCount: skipped.length,
        pending,
        failed,
        elapsedMs: Date.now() - started,
    };
}
