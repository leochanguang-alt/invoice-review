/**
 * 修复 Invoice_ID 命名规则
 * 规则: {ProjectCode}-{4位序号}-{金额}{货币}
 * 负数金额用 m 前缀: -600 -> m600
 */

import 'dotenv/config';
import { google } from 'googleapis';

function cleanEnv(v) {
    if (!v) return "";
    v = v.trim();
    if (v.startsWith('"') && v.endsWith('"')) {
        v = v.substring(1, v.length - 1);
    } else if (v.startsWith("'") && v.endsWith("'")) {
        v = v.substring(1, v.length - 1);
    }
    v = v.replace(/\\n$/, '');
    return v;
}

const SHEET_ID = cleanEnv(process.env.SHEET_ID);
const MAIN_SHEET = cleanEnv(process.env.MAIN_SHEET) || "Main";

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

function norm(v) {
    return (v ?? "").toString().trim();
}

function toA1Column(n) {
    let s = "";
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function getDriveAuth() {
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
        console.log("[AUTH] Using OAuth2");
        const oauth2Client = new google.auth.OAuth2(
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
        return oauth2Client;
    }

    const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY;
    const email = cleanEnv(rawEmail);
    let key = cleanEnv(rawKey);

    if (!email || !key) {
        throw new Error("Missing auth env");
    }

    key = key.replace(/\\n/g, "\n");
    return new google.auth.JWT({
        email,
        key,
        scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive"
        ],
    });
}

async function main() {
    console.log("=== 修复 Invoice_ID ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. 获取 Projects 表的所有 Project Code
    console.log("[STEP 1] 读取 Projects 表...");
    const projectsRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Projects!A:Z',
        valueRenderOption: 'FORMATTED_VALUE'
    });

    const projectsData = projectsRes.data.values || [];
    const projectsHeaders = (projectsData[0] || []).map(norm);
    const projectCodeIdx = projectsHeaders.findIndex(h =>
        h.toLowerCase() === 'project code' || h.toLowerCase() === 'projectcode'
    );

    const validProjectCodes = new Set();
    for (let i = 1; i < projectsData.length; i++) {
        const code = norm(projectsData[i]?.[projectCodeIdx]);
        if (code) {
            validProjectCodes.add(code.toLowerCase());
        }
    }
    console.log(`   找到 ${validProjectCodes.size} 个有效的 Project Code\n`);

    // 2. 获取 Main 表数据
    console.log("[STEP 2] 读取 Main 表...");
    const mainRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${MAIN_SHEET}!A:Z`,
        valueRenderOption: 'FORMATTED_VALUE'
    });

    const mainData = mainRes.data.values || [];
    const mainHeaders = (mainData[0] || []).map(norm);

    const invoiceIdIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'invoice_id' || h.toLowerCase() === 'invoice id'
    );
    const projectIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'charge to project' || h.toLowerCase() === 'chargetoproject'
    );
    const amountIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'amount'
    );
    const currencyIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'currency'
    );

    if (invoiceIdIdx === -1) {
        console.error("❌ Main 表中找不到 'Invoice_ID' 列");
        return;
    }

    console.log(`   Invoice_ID 列索引: ${invoiceIdIdx} (${toA1Column(invoiceIdIdx + 1)}列)\n`);

    // 3. 找出需要修复的行
    console.log("[STEP 3] 检查需要修复的 Invoice_ID...\n");

    const fixes = [];

    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const invoiceId = norm(row[invoiceIdIdx]);
        const projectCode = norm(row[projectIdx]);
        const amount = norm(row[amountIdx]);
        const currency = norm(row[currencyIdx]);
        const rowNum = i + 1;

        // 跳过空的 Invoice_ID
        if (!invoiceId) continue;

        // 解析当前 Invoice_ID 获取序号
        const parts = invoiceId.split('-');
        if (parts.length < 3) continue;

        // 提取序号 (倒数第二段)
        let seqPart = parts[parts.length - 2];

        // 处理特殊情况: BUI-2025-0851--600GBP (序号是空的，我们需要找到正确的序号)
        if (seqPart === '') {
            // 这是负数金额的特殊情况，序号在再前一段
            seqPart = parts[parts.length - 3];
        }

        // 验证序号格式
        if (!/^\d{4}$/.test(seqPart)) {
            // 尝试从 ID 中提取 4 位数字作为序号
            const seqMatch = invoiceId.match(/-(\d{4})-/);
            if (seqMatch) {
                seqPart = seqMatch[1];
            } else {
                console.log(`   ⚠️ 第 ${rowNum} 行: 无法提取序号，跳过`);
                continue;
            }
        }

        // 计算正确的金额部分
        const amountNum = parseFloat(amount.replace(/,/g, '')) || 0;
        let amountStr;
        if (amountNum < 0) {
            // 负数用 m 前缀
            amountStr = 'm' + Math.abs(Math.round(amountNum));
        } else {
            amountStr = Math.round(amountNum).toString();
        }

        // 生成正确的 Invoice_ID
        const correctInvoiceId = `${projectCode}-${seqPart}-${amountStr}${currency}`;

        // 检查是否需要修复
        if (invoiceId !== correctInvoiceId) {
            fixes.push({
                rowNumber: rowNum,
                oldId: invoiceId,
                newId: correctInvoiceId,
                projectCode,
                amount,
                currency
            });
        }
    }

    if (fixes.length === 0) {
        console.log("   ✅ 所有 Invoice_ID 都已正确，无需修复！\n");
        return;
    }

    console.log(`   需要修复 ${fixes.length} 个 Invoice_ID:\n`);
    fixes.forEach(fix => {
        console.log(`   第 ${fix.rowNumber} 行:`);
        console.log(`      旧: "${fix.oldId}"`);
        console.log(`      新: "${fix.newId}"`);
        console.log("");
    });

    // 4. 批量更新
    console.log("[STEP 4] 更新 Invoice_ID...");

    const invoiceIdCol = toA1Column(invoiceIdIdx + 1);
    const updates = fixes.map(fix => ({
        range: `${MAIN_SHEET}!${invoiceIdCol}${fix.rowNumber}`,
        values: [[fix.newId]]
    }));

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates
        }
    });

    console.log(`   ✅ 已更新 ${fixes.length} 个 Invoice_ID！\n`);

    // 5. 清除黄色标记
    console.log("[STEP 5] 清除黄色标记...");

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties'
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === MAIN_SHEET);
    const mainSheetId = sheet.properties.sheetId;

    // 清除所有已修复行的背景色
    const clearRequests = fixes.map(fix => ({
        repeatCell: {
            range: {
                sheetId: mainSheetId,
                startRowIndex: fix.rowNumber - 1,
                endRowIndex: fix.rowNumber,
                startColumnIndex: 0,
                endColumnIndex: mainHeaders.length
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: {
                        red: 1.0,
                        green: 1.0,
                        blue: 1.0,
                        alpha: 1.0
                    }
                }
            },
            fields: 'userEnteredFormat.backgroundColor'
        }
    }));

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            requests: clearRequests
        }
    });

    console.log(`   ✅ 已清除 ${fixes.length} 行的黄色标记！\n`);

    console.log("=== 修复完成 ===");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
