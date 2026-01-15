import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { supabase } from './api/_supabase.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// R2 Configuration
const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PREFIX = 'bui_invoice/original_files/fr_google_drive/';
const GENAI_MODEL = 'gemini-2.0-flash';
const LOG_FILE = path.join(process.cwd(), 'sync-log.txt');
const DAYS_BACK = Number(process.env.R2_SCAN_DAYS_BACK || 90); // 仅扫描最近N天

// Construct public R2 URL (adjust based on your R2 bucket configuration)
// If using custom domain: https://your-domain.com/
// If using R2.dev: https://pub-xxx.r2.dev/
const RAW_R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${BUCKET_NAME}.r2.cloudflarestorage.com`;
// Normalize: remove trailing slash, we'll add it when concatenating
const R2_PUBLIC_URL_BASE = RAW_R2_PUBLIC_URL.replace(/\/+$/, '') + '/';

// Log function to write to sync-log.txt
function writeLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logEntry);
    console.log(logEntry.trim());
}

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function getMimeType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// Get current record count from Supabase
async function getRecordCount() {
    const { count } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
    return count || 0;
}

const cleanAmount = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const cleaned = val.toString().replace(/[^\d.-]/g, '');
    return parseFloat(cleaned) || 0;
};

const cleanString = (val) => (val || '').toString().trim();

async function processInvoices() {
    console.log('--- Starting R2-Based Invoice Processing ---');

    if (process.env.ENABLE_GEMINI_INGEST !== 'true') {
        console.log('Gemini ingest disabled (set ENABLE_GEMINI_INGEST=true to enable). Exit.');
        return;
    }

    // Record count before processing
    const countBefore = await getRecordCount();
    writeLog(`=== Sync Started === Records before: ${countBefore}`);

    if (!process.env.GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is missing in environment variables.');
        return;
    }

    if (!supabase) {
        console.error('Error: Supabase client is not initialized. Check your environment.');
        return;
    }

    if (!process.env.R2_ENDPOINT) {
        console.error('Error: R2_ENDPOINT is missing in environment variables.');
        return;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GENAI_MODEL });

    try {
        // 1. List files in R2 fr_google_drive prefix
        console.log(`Scanning R2 prefix: ${R2_PREFIX}`);

        let continuationToken = null;
        const allFiles = [];

        do {
            const listRes = await r2.send(new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: R2_PREFIX,
                ContinuationToken: continuationToken,
            }));

            for (const obj of listRes.Contents || []) {
                const filename = obj.Key.split('/').pop();
                const ext = filename.toLowerCase().split('.').pop();

                // Filter for PDFs and images only
                if (['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                    allFiles.push({
                        key: obj.Key,
                        name: filename,
                        mimeType: getMimeType(filename),
                        size: obj.Size,
                        lastModified: obj.LastModified,
                        etag: obj.ETag?.replace(/"/g, '') // Extract ETag
                    });
                }
            }

            continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : null;
        } while (continuationToken);

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - DAYS_BACK);
        const filtered = allFiles.filter(f => (f.lastModified ? new Date(f.lastModified) >= cutoff : true));
        console.log(`Found ${allFiles.length} PDF/image files in R2. Filtering to last ${DAYS_BACK} days => ${filtered.length}`);

        const filesToProcess = filtered;

        for (const file of filesToProcess) {
            console.log(`\nProcessing file: ${file.name} (${file.key})`);

            // Generate hash ID from R2 key for consistency
            const fileHash = crypto.createHash('md5').update(file.key).digest('hex').substring(0, 12);

            // 2. Check if already processed in Supabase (check file_ID_HASH_R2)
            // We check file_ID_HASH_R2. We can also check file_id for legacy compatibility if needed.
            let query = supabase
                .from('invoices')
                .select('id,vendor,amount,currency,invoice_date,invoice_number,location_city,country,category,status')
                .or(`file_ID_HASH_R2.eq.${fileHash},file_ID_HASH_R2.eq.${file.etag}`)
                .maybeSingle();

            const { data: existing, error: checkError } = await query;

            if (checkError) {
                console.error(`Error checking Supabase for ${fileHash}:`, checkError.message);
                continue;
            }

            if (existing) {
                const hasParsedData =
                    (existing.vendor && existing.vendor.trim() !== '') ||
                    (existing.invoice_date && existing.invoice_date.trim() !== '') ||
                    (existing.invoice_number && existing.invoice_number.trim() !== '') ||
                    (existing.amount !== null && existing.amount !== undefined && existing.amount !== '');
                if (hasParsedData) {
                    console.log(`File already processed with data (hash: ${fileHash}, etag: ${file.etag}). Skipping.`);
                    continue;
                } else {
                    console.log(`Existing record lacks parsed fields; will reprocess and update. id=${existing.id}`);
                }
            }

            try {
                // 3. Download file from R2
                console.log('Downloading file from R2...');
                const getRes = await r2.send(new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: file.key,
                }));

                const buffer = await streamToBuffer(getRes.Body);

                // Gemini Extraction
                const prompt = `请分析这张发票图片。提取以下信息并以严格的 JSON 格式返回，不要包含任何 Markdown 格式或解释性文字：
invoice_number (发票号码)
date (日期, 格式 YYYY-MM-DD)
vendor_name (供应商名称)
City:(费用发生的城市）
Country:(费用发生的国家）
total_amount (总金额, 数字格式)
currency (货币单位选择其一:GBP/HKD/USD/EUR/SEK/DKK/CHF/CNY/CAD/AED)
category(费用用途选择其中之一：Hotel/Flight/Train/Taxi/Entertainment/office expense/Communication/IT expense/Meal)`;

                const result = await model.generateContent([
                    {
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: file.mimeType
                        }
                    },
                    prompt
                ]);

                const responseText = result.response.text();
                let jsonStr = responseText;
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) jsonStr = jsonMatch[0];

                const invoiceData = JSON.parse(jsonStr);

                // Data Cleaning & Normalization
                const getVal = (obj, keys) => {
                    for (const k of keys) {
                        if (obj[k] !== undefined && obj[k] !== null) return obj[k];
                    }
                    return null;
                };

                const rawDate = getVal(invoiceData, ['date', 'invoice_date']);
                const rawVendor = getVal(invoiceData, ['vendor_name', 'vendor']);
                const rawAmount = getVal(invoiceData, ['total_amount', 'amount']);
                const rawCurrency = getVal(invoiceData, ['currency']);
                const rawInvoiceNum = getVal(invoiceData, ['invoice_number', 'invoice_no']);
                const rawCity = getVal(invoiceData, ['city', 'City', 'location_city']);
                const rawCountry = getVal(invoiceData, ['country', 'Country']);
                const rawCategory = getVal(invoiceData, ['category']);

                const processedData = {
                    file_ID_HASH_R2: file.etag,  // Use R2 ETag for consistency
                    // file_id:  // We do NOT set file_id here as we don't have the Google Drive ID
                    invoice_date: cleanString(rawDate),
                    vendor: cleanString(rawVendor),
                    amount: cleanAmount(rawAmount),
                    currency: cleanString(rawCurrency),
                    invoice_number: cleanString(rawInvoiceNum),
                    location_city: cleanString(rawCity),
                    country: cleanString(rawCountry),
                    category: cleanString(rawCategory),
                    file_link_r2: `${R2_PUBLIC_URL_BASE}${file.key}`,  // New R2 link column
                    // file_link: // Legacy column, stop populating or keep for backward compat? User said move to _r2.
                    status: 'Waiting for Confirm'
                };

                console.log('Processed Data:', JSON.stringify(processedData, null, 2));

                // 5. Insert or update Supabase
                if (existing) {
                    console.log(`Updating existing record id=${existing.id}...`);
                    const { error: updateError } = await supabase
                        .from('invoices')
                        .update(processedData)
                        .eq('id', existing.id);

                    if (updateError) {
                        console.error('Error updating Supabase:', {
                            message: updateError.message,
                            details: updateError.details,
                            hint: updateError.hint,
                            code: updateError.code
                        });
                        writeLog(`UPDATE ERROR: ${file.name} - ${updateError.message}`);
                    } else {
                        console.log('✅ Successfully updated Supabase. ID:', existing.id);
                        writeLog(`UPDATED RECORD: ID=${existing.id} | File=${file.name} | Vendor=${processedData.vendor} | Amount=${processedData.amount} ${processedData.currency}`);
                    }
                } else {
                    console.log('Inserting into Supabase...');
                    const { data: insertResult, error: insertError } = await supabase
                        .from('invoices')
                        .insert([processedData])
                        .select();

                    if (insertError) {
                        console.error('Error inserting into Supabase:', {
                            message: insertError.message,
                            details: insertError.details,
                            hint: insertError.hint,
                            code: insertError.code
                        });
                        writeLog(`INSERT ERROR: ${file.name} - ${insertError.message}`);
                    } else {
                        console.log('✅ Successfully saved to Supabase. ID:', insertResult?.[0]?.id);
                        writeLog(`NEW RECORD: ID=${insertResult?.[0]?.id} | File=${file.name} | Vendor=${processedData.vendor} | Amount=${processedData.amount} ${processedData.currency}`);
                    }
                }
            } catch (fileErr) {
                console.error(`Error processing file ${file.name}:`, fileErr.message || fileErr);
            }
        }

    } catch (err) {
        console.error('An unexpected error occurred during scan:', err);
        writeLog(`ERROR: ${err.message}`);
    }

    // Record count after processing
    const countAfter = await getRecordCount();
    const newRecords = countAfter - countBefore;

    writeLog(`=== Sync Finished === Records after: ${countAfter} | New records added: ${newRecords}`);

    if (newRecords > 0) {
        writeLog(`WARNING: ${newRecords} new records were added during this sync!`);
    }

    console.log('\n--- Processing Finished ---');
}

const POLL_INTERVAL = 1 * 60 * 1000; // 1 minute

async function run() {
    const isWatchMode = process.argv.includes('--watch');

    if (isWatchMode) {
        console.log(`--- Starting R2 Invoice Watch Mode (Interval: ${POLL_INTERVAL / 1000 / 60} mins) ---`);
        while (true) {
            try {
                await processInvoices();
            } catch (e) {
                console.error('Critical loop error:', e);
            }
            console.log(`Waiting ${POLL_INTERVAL / 1000 / 60} minutes for next scan...`);
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
    } else {
        await processInvoices();
    }
}

run();
