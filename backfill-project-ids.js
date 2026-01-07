/**
 * 一次性脚本：为现有的 Projects 表填充 ProjectID
 * 
 * 用法: node backfill-project-ids.js
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const PROJECTS_SHEET = 'Projects';

// 生成随机6位大写字母ID
function generateRandomId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

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

// 列号转A1格式
function toA1Column(n) {
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

async function main() {
    console.log('正在连接 Google Sheets...');
    const sheets = getSheetsClient();

    // 读取所有数据
    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${PROJECTS_SHEET}!A:Z`,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = dataRes.data.values || [];
    if (values.length === 0) {
        console.log('Projects 表为空');
        return;
    }

    const headers = values[0].map(h => h.trim().toLowerCase());
    const projectIdColIdx = headers.findIndex(h => h === 'projectid' || h === 'project id' || h === 'project_id');

    if (projectIdColIdx === -1) {
        console.error('找不到 ProjectID 列！请检查表头。');
        return;
    }

    console.log(`ProjectID 列位置: 第 ${projectIdColIdx + 1} 列 (${toA1Column(projectIdColIdx + 1)})`);

    // 收集已有的 ID
    const existingIds = new Set();
    for (let i = 1; i < values.length; i++) {
        const id = (values[i][projectIdColIdx] || '').trim().toUpperCase();
        if (id) existingIds.add(id);
    }

    console.log(`现有 ID 数量: ${existingIds.size}`);

    // 找出需要填充的行
    const updates = [];
    for (let i = 1; i < values.length; i++) {
        const currentId = (values[i][projectIdColIdx] || '').trim();
        if (!currentId) {
            // 生成唯一 ID
            let newId;
            do {
                newId = generateRandomId(6);
            } while (existingIds.has(newId));
            existingIds.add(newId);

            const rowNumber = i + 1; // 1-based
            const col = toA1Column(projectIdColIdx + 1);
            updates.push({
                range: `${PROJECTS_SHEET}!${col}${rowNumber}`,
                values: [[newId]]
            });
            console.log(`  行 ${rowNumber}: 生成 ID -> ${newId}`);
        }
    }

    if (updates.length === 0) {
        console.log('所有行都已有 ProjectID，无需更新。');
        return;
    }

    console.log(`\n准备更新 ${updates.length} 行...`);

    // 批量更新
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates
        }
    });

    console.log('✅ 完成！所有空的 ProjectID 已填充。');
}

main().catch(e => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
