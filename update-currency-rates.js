/**
 * 汇率更新脚本
 * 
 * 功能：
 * 1. 从 currency_list 表读取货币代码
 * 2. 通过免费 API 获取各货币对 HKD 的汇率
 * 3. 将汇率写入 currency_History 表
 * 
 * 用法: node update-currency-rates.js
 * 
 * 每月第一天运行此脚本更新汇率
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const CURRENCY_LIST_SHEET = 'currency_list';
const CURRENCY_HISTORY_SHEET = 'currency_History';

// 清理环境变量
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

// 获取 Sheets 客户端
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

// 获取汇率 (使用 exchangerate-api.com 免费 API)
async function getExchangeRate(fromCurrency, toCurrency = 'HKD') {
    try {
        // 使用免费的 exchangerate-api
        const url = `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`  ⚠️ API 请求失败: ${fromCurrency} -> ${response.status}`);
            return null;
        }

        const data = await response.json();
        const rate = data.rates[toCurrency];

        if (rate) {
            return rate;
        } else {
            console.error(`  ⚠️ 未找到 ${toCurrency} 汇率`);
            return null;
        }
    } catch (e) {
        console.error(`  ⚠️ 获取 ${fromCurrency} 汇率失败:`, e.message);
        return null;
    }
}

// 格式化日期为 YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 获取本月第一天
function getFirstDayOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function main() {
    console.log('===========================================');
    console.log('          汇率更新脚本');
    console.log('===========================================\n');

    const sheets = getSheetsClient();
    const today = new Date();
    const firstDay = getFirstDayOfMonth();
    const dateStr = formatDate(firstDay);

    console.log(`📅 当前日期: ${formatDate(today)}`);
    console.log(`📅 月初日期: ${dateStr}`);
    console.log('');

    // 1. 读取货币列表
    console.log('📋 正在读取货币列表...');
    const currencyListRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${CURRENCY_LIST_SHEET}!A:A`,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const currencyRows = currencyListRes.data.values || [];
    if (currencyRows.length <= 1) {
        console.log('❌ 货币列表为空');
        return;
    }

    // 跳过表头
    const currencies = currencyRows.slice(1).map(r => (r[0] || '').trim().toUpperCase()).filter(c => c);
    console.log(`   找到 ${currencies.length} 种货币: ${currencies.join(', ')}\n`);

    // 2. 读取现有历史记录，检查是否已有本月记录
    console.log('📋 正在检查历史记录...');
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

    // 3. 获取汇率并准备更新
    console.log('\n💱 正在获取汇率...');
    const newRows = [];

    for (const currency of currencies) {
        const recordKey = `${currency}_${dateStr}`;

        if (existingRecords.has(recordKey)) {
            console.log(`   ⏭️ ${currency}: 本月记录已存在，跳过`);
            continue;
        }

        if (currency === 'HKD') {
            // HKD 对 HKD 汇率是 1
            newRows.push([currency, dateStr, '1']);
            console.log(`   ✅ ${currency}: 1 (本币)`);
        } else {
            const rate = await getExchangeRate(currency);
            if (rate !== null) {
                newRows.push([currency, dateStr, rate.toString()]);
                console.log(`   ✅ ${currency}: ${rate}`);
            } else {
                console.log(`   ❌ ${currency}: 获取失败`);
            }
        }

        // 稍微延迟以避免 API 限流
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 4. 写入 Google Sheets
    if (newRows.length === 0) {
        console.log('\n✅ 没有需要更新的记录');
        return;
    }

    console.log(`\n📝 正在写入 ${newRows.length} 条记录...`);

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${CURRENCY_HISTORY_SHEET}!A:C`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: newRows
        }
    });

    console.log('\n===========================================');
    console.log('   ✅ 汇率更新完成！');
    console.log('===========================================');
}

main().catch(e => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
