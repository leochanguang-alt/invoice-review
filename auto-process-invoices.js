import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth, json } from './api/_sheets.js';
import { supabase } from './api/_supabase.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Readable } from 'stream';

const FOLDER_ID = '1-SfI4cPugsqOuMzgtBPwv9Ca3JVGSlc3';
const GENAI_MODEL = 'gemini-1.5-flash';

async function processInvoices() {
    console.log('--- Starting Local Invoice Processing ---');

    if (!process.env.GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is missing in environment variables.');
        return;
    }

    if (!supabase) {
        console.error('Error: Supabase client is not initialized. Check your environment.');
        return;
    }

    const auth = getDriveAuth();
    const drive = google.drive({ version: 'v3', auth });
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GENAI_MODEL });

    try {
        // 1. List files in the target folder
        console.log(`Scanning folder: ${FOLDER_ID}`);
        const listRes = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType contains 'image/')`,
            fields: 'files(id, name, mimeType, webContentLink, webViewLink)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const files = listRes.data.files || [];
        console.log(`Found ${files.length} candidates.`);

        for (const file of files) {
            console.log(`\nProcessing file: ${file.name} (${file.id})`);

            // 2. Check if already processed in Supabase
            const { data: existing, error: checkError } = await supabase
                .from('invoices')
                .select('id')
                .eq('file_id', file.id)
                .maybeSingle();

            if (checkError) {
                console.error(`Error checking Supabase for ${file.id}:`, checkError.message);
                continue;
            }

            if (existing) {
                console.log(`File already processed. Skipping.`);
                continue;
            }

            // 3. Download file
            console.log('Downloading file...');
            const driveRes = await drive.files.get(
                { fileId: file.id, alt: 'media', supportsAllDrives: true },
                { responseType: 'arraybuffer' }
            );
            const buffer = Buffer.from(driveRes.data);

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

            const invoiceData = JSON.parse(jsonStr);

            // 5. Insert into Supabase
            console.log('Inserting into Supabase...');
            const { error: insertError } = await supabase
                .from('invoices')
                .insert([{
                    file_id: file.id,
                    invoice_date: invoiceData.date,
                    vendor: invoiceData.vendor_name,
                    amount: parseFloat(invoiceData.total_amount),
                    currency: invoiceData.currency,
                    invoice_number: invoiceData.invoice_number,
                    location_city: invoiceData.City,
                    country: invoiceData.Country,
                    category: invoiceData.category,
                    file_link: file.webViewLink,
                    status: 'Waiting for Confirm'
                }]);

            if (insertError) {
                console.error('Error inserting into Supabase:', insertError.message);
            } else {
                console.log('Successfully processed and saved to Supabase.');
            }
        }

    } catch (err) {
        console.error('An unexpected error occurred:', err);
    }

    console.log('\n--- Processing Finished ---');
}

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function run() {
    const isWatchMode = process.argv.includes('--watch');

    if (isWatchMode) {
        console.log(`--- Starting Global Invoice Watch Mode (Interval: ${POLL_INTERVAL / 1000 / 60} mins) ---`);
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
