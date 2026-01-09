import 'dotenv/config';
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

// Construct public R2 URL (adjust based on your R2 bucket configuration)
// If using custom domain: https://your-domain.com/
// If using R2.dev: https://pub-xxx.r2.dev/
const R2_PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL || `https://${BUCKET_NAME}.r2.cloudflarestorage.com/`;

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

async function processInvoices() {
    console.log('--- Starting R2-Based Invoice Processing ---');

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
                        lastModified: obj.LastModified
                    });
                }
            }

            continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : null;
        } while (continuationToken);

        console.log(`Found ${allFiles.length} PDF/image files in R2.`);

        for (const file of allFiles) {
            console.log(`\nProcessing file: ${file.name} (${file.key})`);

            // 2. Check if already processed in Supabase (using R2 key as file_id)
            const { data: existing, error: checkError } = await supabase
                .from('invoices')
                .select('id')
                .eq('file_id', file.key)
                .maybeSingle();

            if (checkError) {
                console.error(`Error checking Supabase for ${file.key}:`, checkError.message);
                continue;
            }

            if (existing) {
                console.log(`File already processed. Skipping.`);
                continue;
            }

            try {
                // 3. Download file from R2
                console.log('Downloading file from R2...');
                const getRes = await r2.send(new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: file.key,
                }));

                const buffer = await streamToBuffer(getRes.Body);

                // 4. Extract data with Gemini
                console.log('Extracting data with Gemini...');
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
                console.log('Gemini raw response:', responseText);

                // Robust JSON extraction
                let jsonStr = responseText;
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                }

                let invoiceData;
                try {
                    invoiceData = JSON.parse(jsonStr);
                } catch (parseErr) {
                    console.error('Failed to parse Gemini JSON. Raw text:', responseText);
                    throw new Error('Gemini response was not valid JSON');
                }

                // Normalizing field names
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

                // Data Cleaning
                const cleanAmount = (val) => {
                    if (typeof val === 'number') return val;
                    if (!val) return 0;
                    const cleaned = val.toString().replace(/[^\d.-]/g, '');
                    return parseFloat(cleaned) || 0;
                };

                const cleanString = (val) => (val || '').toString().trim();

                // Use R2 key as file_id and construct R2 URL for file_link
                const processedData = {
                    file_id: file.key,  // R2 object key
                    invoice_date: cleanString(rawDate),
                    vendor: cleanString(rawVendor),
                    amount: cleanAmount(rawAmount),
                    currency: cleanString(rawCurrency),
                    invoice_number: cleanString(rawInvoiceNum),
                    location_city: cleanString(rawCity),
                    country: cleanString(rawCountry),
                    category: cleanString(rawCategory),
                    file_link: `${R2_PUBLIC_URL_BASE}${file.key}`,  // R2 public URL
                    status: 'Waiting for Confirm'
                };

                console.log('Processed Data:', JSON.stringify(processedData, null, 2));

                // 5. Insert into Supabase
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
                } else {
                    console.log('✅ Successfully saved to Supabase. ID:', insertResult?.[0]?.id);
                }
            } catch (fileErr) {
                console.error(`Error processing file ${file.name}:`, fileErr.message || fileErr);
            }
        }

    } catch (err) {
        console.error('An unexpected error occurred during scan:', err);
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
