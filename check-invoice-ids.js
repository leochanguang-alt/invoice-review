/**
 * 检查 Main 表中的 Invoice_ID 是否符合命名规则
 * 规则: {ProjectCode}-{4位序号}-{金额整数}{货币}
 * 例如: BUI-2512-0001-100HKD
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

async function getSheetId(sheets, sheetName) {
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties'
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
    }
    return sheet.properties.sheetId;
}

async function main() {
    console.log("=== 检查 Invoice_ID 命名规则 ===\n");
    console.log("规则: {ProjectCode}-{4位序号}-{金额整数}{货币}");
    console.log("例如: BUI-2512-0001-100HKD\n");

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

    // 找到需要的列索引
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
    const statusIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'status'
    );

    if (invoiceIdIdx === -1) {
        console.error("❌ Main 表中找不到 'Invoice_ID' 列");
        return;
    }

    console.log(`   Main 表共有 ${mainData.length - 1} 行数据\n`);

    // 3. 检查每一行的 Invoice_ID
    console.log("[STEP 3] 检查 Invoice_ID 格式...\n");

    const issues = [];
    let checkedCount = 0;
    let emptyCount = 0;
    let validCount = 0;

    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const invoiceId = norm(row[invoiceIdIdx]);
        const projectCode = norm(row[projectIdx]);
        const amount = norm(row[amountIdx]);
        const currency = norm(row[currencyIdx]);
        const status = norm(row[statusIdx]);
        const rowNum = i + 1;

        // 跳过空的 Invoice_ID (未提交的记录)
        if (!invoiceId) {
            emptyCount++;
            continue;
        }

        checkedCount++;

        // 解析 Invoice_ID
        // 格式: ProjectCode-Seq-AmountCurrency
        // 例如: BUI-2512-0001-100HKD

        const issueList = [];

        // 尝试匹配格式
        // ProjectCode 可能包含多个 "-"，所以我们从后往前找
        const parts = invoiceId.split('-');

        if (parts.length < 3) {
            issues.push({
                rowNumber: rowNum,
                invoiceId,
                projectCode,
                amount,
                currency,
                issue: `格式错误: 应有至少3段(用-分隔)，当前只有 ${parts.length} 段`
            });
            continue;
        }

        // 最后一段是 AmountCurrency (如 100HKD)
        const lastPart = parts[parts.length - 1];
        // 倒数第二段是序号 (如 0001)
        const seqPart = parts[parts.length - 2];
        // 前面的都是 ProjectCode
        const projectCodePart = parts.slice(0, parts.length - 2).join('-');

        // 检查序号格式 (应该是4位数字)
        if (!/^\d{4}$/.test(seqPart)) {
            issueList.push(`序号格式错误: "${seqPart}" 应为4位数字`);
        }

        // 检查 AmountCurrency 格式
        // 支持 m 前缀表示负数金额，如 m600GBP 表示 -600 GBP
        const amountCurrencyMatch = lastPart.match(/^(m?)(\d+)([A-Za-z]+)$/);
        if (!amountCurrencyMatch) {
            issueList.push(`金额货币格式错误: "${lastPart}" 应为 "金额+货币" 如 "100HKD" 或 "m600GBP"`);
        } else {
            const isNegative = amountCurrencyMatch[1] === 'm';
            const idAmountNum = parseInt(amountCurrencyMatch[2]);
            const idCurrency = amountCurrencyMatch[3];
            const actualAmount = isNegative ? -idAmountNum : idAmountNum;

            // 检查货币是否匹配
            if (currency && idCurrency.toUpperCase() !== currency.toUpperCase()) {
                issueList.push(`货币不匹配: ID中是 "${idCurrency}"，记录中是 "${currency}"`);
            }

            // 检查金额是否匹配 (取整数部分)
            if (amount) {
                const expectedAmount = Math.round(parseFloat(amount.replace(/,/g, '')) || 0);
                if (expectedAmount !== actualAmount) {
                    issueList.push(`金额不匹配: ID中是 ${actualAmount}，记录中是 ${expectedAmount}`);
                }
            }
        }

        // 检查 ProjectCode 是否匹配
        if (projectCode && projectCodePart.toLowerCase() !== projectCode.toLowerCase()) {
            issueList.push(`ProjectCode不匹配: ID中是 "${projectCodePart}"，记录中是 "${projectCode}"`);
        }

        // 检查 ProjectCode 是否有效
        if (!validProjectCodes.has(projectCodePart.toLowerCase())) {
            issueList.push(`ProjectCode无效: "${projectCodePart}" 不在 Projects 表中`);
        }

        if (issueList.length > 0) {
            issues.push({
                rowNumber: rowNum,
                invoiceId,
                projectCode,
                amount,
                currency,
                issue: issueList.join('; ')
            });
        } else {
            validCount++;
        }
    }

    // 4. 输出结果
    console.log("=== 检查结果 ===\n");
    console.log(`总行数: ${mainData.length - 1}`);
    console.log(`空 Invoice_ID (未提交): ${emptyCount}`);
    console.log(`已检查 Invoice_ID: ${checkedCount}`);
    console.log(`格式正确: ${validCount}`);
    console.log(`发现问题: ${issues.length}\n`);

    if (issues.length === 0) {
        console.log("✅ 所有 Invoice_ID 格式都正确！\n");
        return;
    }

    console.log("⚠️  发现以下问题:\n");
    issues.forEach(issue => {
        console.log(`第 ${issue.rowNumber} 行:`);
        console.log(`   Invoice_ID: "${issue.invoiceId}"`);
        console.log(`   Project: "${issue.projectCode}", Amount: "${issue.amount}", Currency: "${issue.currency}"`);
        console.log(`   问题: ${issue.issue}`);
        console.log("");
    });

    // 5. 标记有问题的行为黄色
    console.log("[STEP 4] 将有问题的行标记为黄色...");

    const mainSheetId = await getSheetId(sheets, MAIN_SHEET);

    const requests = issues.map(issue => ({
        repeatCell: {
            range: {
                sheetId: mainSheetId,
                startRowIndex: issue.rowNumber - 1,
                endRowIndex: issue.rowNumber,
                startColumnIndex: 0,
                endColumnIndex: mainHeaders.length
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: {
                        red: 1.0,
                        green: 1.0,
                        blue: 0.0,
                        alpha: 1.0
                    }
                }
            },
            fields: 'userEnteredFormat.backgroundColor'
        }
    }));

    if (requests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                requests: requests
            }
        });
        console.log(`   ✅ 已将 ${issues.length} 行标记为黄色！\n`);
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
