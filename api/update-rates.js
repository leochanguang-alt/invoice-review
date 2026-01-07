/**
 * 自动汇率更新 API
 * 
 * 每月第一天自动调用此接口更新汇率
 * 可以配合 cron job 或云函数定时触发
 * 
 * GET /api/update-rates - 手动触发更新
 * GET /api/update-rates?force=true - 强制更新（即使不是月初）
 */

import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const CURRENCY_LIST_SHEET = 'currency_list';
const CURRENCY_HISTORY_SHEET = 'currency_History';

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

async function getExchangeRate(fromCurrency, toCurrency = 'HKD') {
    try {
        const url = `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data.rates[toCurrency] || null;
    } catch (e) {
        return null;
    }
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getFirstDayOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default async function handler(req, res) {
    try {
        const today = new Date();
        const isFirstDay = today.getDate() === 1;
        const forceUpdate = req.query.force === 'true';

        // 只在每月第一天运行，除非强制更新
        if (!isFirstDay && !forceUpdate) {
            return res.json({
                success: true,
                message: '今天不是月初，无需更新汇率',
                today: formatDate(today),
                nextUpdate: formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 1))
            });
        }

        const sheets = getSheetsClient();
        const firstDay = getFirstDayOfMonth();
        const dateStr = formatDate(firstDay);

        // 读取货币列表
        const currencyListRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${CURRENCY_LIST_SHEET}!A:A`,
            valueRenderOption: 'FORMATTED_VALUE',
        });

        const currencyRows = currencyListRes.data.values || [];
        if (currencyRows.length <= 1) {
            return res.json({ success: false, message: '货币列表为空' });
        }

        const currencies = currencyRows.slice(1).map(r => (r[0] || '').trim().toUpperCase()).filter(c => c);

        // 检查历史记录
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
            if (code && date) existingRecords.add(`${code}_${date}`);
        }

        // 获取汇率
        const newRows = [];
        const results = [];

        for (const currency of currencies) {
            const recordKey = `${currency}_${dateStr}`;

            if (existingRecords.has(recordKey)) {
                results.push({ currency, status: 'skipped', message: '已存在' });
                continue;
            }

            if (currency === 'HKD') {
                newRows.push([currency, dateStr, '1']);
                results.push({ currency, rate: 1, status: 'success' });
            } else {
                const rate = await getExchangeRate(currency);
                if (rate !== null) {
                    newRows.push([currency, dateStr, rate.toString()]);
                    results.push({ currency, rate, status: 'success' });
                } else {
                    results.push({ currency, status: 'failed', message: '获取失败' });
                }
            }

            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 写入
        if (newRows.length > 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: `${CURRENCY_HISTORY_SHEET}!A:C`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: newRows }
            });
        }

        return res.json({
            success: true,
            message: `已更新 ${newRows.length} 条汇率记录`,
            date: dateStr,
            results
        });

    } catch (e) {
        console.error('汇率更新错误:', e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
