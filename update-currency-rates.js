/**
 * Exchange Rate Update Script
 * 
 * Features:
 * 1. Read currency codes from currency_list table
 * 2. Fetch exchange rates to HKD via free API
 * 3. Write rates to currency_History table
 * 
 * Usage: node update-currency-rates.js
 * 
 * Run this script on the first day of each month to update rates
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const CURRENCY_LIST_SHEET = 'currency_list';
const CURRENCY_HISTORY_SHEET = 'currency_History';

// Clean environment variable
function cleanEnv(v) {
    if (!v) return '';
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    return v;
}

// Get Sheets client
function getSheetsClient() {
    const email = cleanEnv(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    let key = cleanEnv(process.env.GOOGLE_PRIVATE_KEY);
    key = key.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({
        email,
        key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
}

// Get exchange rate (using exchangerate-api.com free API)
async function getExchangeRate(fromCurrency, toCurrency = 'HKD') {
    try {
        // Use free exchangerate-api
        const url = `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`  ⚠️ API request failed: ${fromCurrency} -> ${response.status}`);
            return null;
        }

        const data = await response.json();
        const rate = data.rates[toCurrency];

        if (rate) {
            return rate;
        } else {
            console.error(`  ⚠️ Rate for ${toCurrency} not found`);
            return null;
        }
    } catch (e) {
        console.error(`  ⚠️ Failed to get ${fromCurrency} rate:`, e.message);
        return null;
    }
}

// Format date as YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get first day of current month
function getFirstDayOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function main() {
    console.log('===========================================');
    console.log('      Exchange Rate Update Script');
    console.log('===========================================\n');

    const sheets = getSheetsClient();
    const today = new Date();
    const firstDay = getFirstDayOfMonth();
    const dateStr = formatDate(firstDay);

    console.log(`📅 Current date: ${formatDate(today)}`);
    console.log(`📅 First day of month: ${dateStr}`);
    console.log('');

    // 1. Read currency list
    console.log('📋 Reading currency list...');
    const currencyListRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${CURRENCY_LIST_SHEET}!A:A`,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const currencyRows = currencyListRes.data.values || [];
    if (currencyRows.length <= 1) {
        console.log('❌ Currency list is empty');
        return;
    }

    // Skip header row
    const currencies = currencyRows.slice(1).map(r => (r[0] || '').trim().toUpperCase()).filter(c => c);
    console.log(`   Found ${currencies.length} currencies: ${currencies.join(', ')}\n`);

    // 2. Read existing history to check if current month records exist
    console.log('📋 Checking history records...');
    const historyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${CURRENCY_HISTORY_SHEET}!A:C`,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const historyRows = historyRes.data.values || [];
    const existingRecords = new Set();
    for (let i = 1; i < historyRows.length; i++) {
        const code = (historyRows[i][0] || '').trim().toUpperCase();
        const date = (historyRows[i][1] || '').trim();
        if (code && date) {
            existingRecords.add(`${code}_${date}`);
        }
    }

    // 3. Get exchange rates and prepare updates
    console.log('\n💱 Fetching exchange rates...');
    const newRows = [];

    for (const currency of currencies) {
        const recordKey = `${currency}_${dateStr}`;

        if (existingRecords.has(recordKey)) {
            console.log(`   ⏭️ ${currency}: Record exists for this month, skipping`);
            continue;
        }

        if (currency === 'HKD') {
            // HKD to HKD rate is 1
            newRows.push([currency, dateStr, '1']);
            console.log(`   ✅ ${currency}: 1 (base currency)`);
        } else {
            const rate = await getExchangeRate(currency);
            if (rate !== null) {
                newRows.push([currency, dateStr, rate.toString()]);
                console.log(`   ✅ ${currency}: ${rate}`);
            } else {
                console.log(`   ❌ ${currency}: Failed to fetch`);
            }
        }

        // Small delay to avoid API rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 4. Write to Google Sheets
    if (newRows.length === 0) {
        console.log('\n✅ No records to update');
        return;
    }

    console.log(`\n📝 Writing ${newRows.length} records...`);

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${CURRENCY_HISTORY_SHEET}!A:C`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: newRows
        }
    });

    console.log('\n===========================================');
    console.log('   ✅ Exchange rate update complete!');
    console.log('===========================================');
}

main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
});
