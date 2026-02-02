import 'dotenv/config';
import { google } from 'googleapis';
import { getDriveAuth, getSheetsClient, SHEET_ID, norm } from './api/_sheets.js';
import { supabase } from './api/_supabase.js';
import { getCurrencyList, linkCurrencyCountry } from './api/currency-country-link.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GENAI_MODEL = 'gemini-3-flash-preview';

async function processFileById(fileId, force = false) {
    console.log(`\n--- Manually Processing File: ${fileId} ---`);

    if (!process.env.GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is missing.');
        return;
    }

    if (!supabase) {
        console.error('Error: Supabase client is not initialized.');
        return;
    }

    // 1. Check existing
    if (!force) {
        const { data: existing, error: checkError } = await supabase
            .from('invoices')
            .select('id')
            .eq('file_id', fileId)
            .maybeSingle();

        if (existing) {
            console.log(`File ${fileId} already processed in Supabase. Use --force to re-process.`);
            return;
        }
    }

    const auth = getDriveAuth();
    console.log('[DEBUG] Auth object created.');
    const drive = google.drive({ version: 'v3', auth });
    console.log('[DEBUG] Drive client created.');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('[DEBUG] Gemini AI client created.');
    const model = genAI.getGenerativeModel({ model: GENAI_MODEL });

    try {
        // 2. Get file metadata
        console.log('Fetching file metadata for ID:', fileId);
        const fileMeta = await drive.files.get({
            fileId: fileId,
            fields: 'id, name, mimeType, webViewLink',
            supportsAllDrives: true
        });
        const file = fileMeta.data;
        console.log(`[DEBUG] File found: ${file.name} (${file.mimeType})`);

        // 3. Download
        console.log(`Downloading: ${file.name}...`);
        const driveRes = await drive.files.get(
            { fileId: fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(driveRes.data);

        // 4. Gemini Extraction
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

        const cleanAmount = (val) => {
            if (typeof val === 'number') return val;
            if (!val) return 0;
            const cleaned = val.toString().replace(/[^\d.-]/g, '');
            return parseFloat(cleaned) || 0;
        };

        const cleanString = (val) => (val || '').toString().trim();

        const processedData = {
            file_id: fileId,
            invoice_date: cleanString(getVal(invoiceData, ['date', 'invoice_date'])),
            vendor: cleanString(getVal(invoiceData, ['vendor_name', 'vendor'])),
            amount: cleanAmount(getVal(invoiceData, ['total_amount', 'amount'])),
            currency: cleanString(getVal(invoiceData, ['currency'])),
            invoice_number: cleanString(getVal(invoiceData, ['invoice_number', 'invoice_no'])),
            location_city: cleanString(getVal(invoiceData, ['city', 'City', 'location_city'])),
            country: cleanString(getVal(invoiceData, ['country', 'Country'])),
            category: cleanString(getVal(invoiceData, ['category'])),
            file_link: file.webViewLink,
            status: 'Waiting for Confirm'
        };

        const currencyList = await getCurrencyList(supabase);
        linkCurrencyCountry(processedData, currencyList);

        console.log('Inserting into Supabase:', JSON.stringify(processedData, null, 2));

        // 5. Insert
        const { data: insertResult, error: insertError } = await supabase
            .from('invoices')
            .upsert([processedData], { onConflict: 'file_id' })
            .select();

        if (insertError) {
            console.error('Error inserting into Supabase:', insertError);
        } else {
            console.log('✅ Successfully processed and saved. Supabase Record ID:', insertResult?.[0]?.id);

            // 6. Also append to Google Sheet 'Main'
            try {
                console.log('Appending to Google Sheet...');
                const sheets = getSheetsClient();

                const headersRes = await sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: 'Main!1:1',
                    valueRenderOption: 'FORMATTED_VALUE',
                });
                const headers = (headersRes.data.values?.[0] || []).map(norm);

                const sheetDataMap = {
                    'file_id': processedData.file_id,
                    'invoice_data': processedData.invoice_date,
                    'vendor': processedData.vendor,
                    'amount': processedData.amount,
                    'currency': processedData.currency,
                    'invoice_number': processedData.invoice_number,
                    'location(city)': processedData.location_city,
                    'country': processedData.country,
                    'category': processedData.category,
                    'file_link': processedData.file_link,
                    'status': processedData.status
                };

                const rowValues = headers.map(h => sheetDataMap[h.toLowerCase()] || '');

                await sheets.spreadsheets.values.append({
                    spreadsheetId: SHEET_ID,
                    range: 'Main!A:A',
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [rowValues] },
                });
                console.log('✅ Successfully appended to Google Sheet.');
            } catch (sheetErr) {
                console.error('Error appending to Sheet:', sheetErr.message || sheetErr);
            }
        }

    } catch (err) {
        console.error(`Error processing file ${fileId}:`);
        console.error(err);
    }
}

// CLI handling
const args = process.argv.slice(2);
const fileIds = args.filter(a => !a.startsWith('--'));
const isForce = args.includes('--force');

if (fileIds.length === 0) {
    console.log('Usage: node process-manual.js <FILE_ID1> <FILE_ID2> ... [--force]');
} else {
    for (const id of fileIds) {
        await processFileById(id, isForce);
    }
}
