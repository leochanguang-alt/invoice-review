/**
 * 检查 Main 表中的 "Charge to Project" 列是否都存在于 Projects 表的 "Project Code" 中
 * 如果不存在，将该行用黄色底色标记
 */

import 'dotenv/config';
import { google } from 'googleapis';

// 复用 _sheets.js 中的工具函数
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

    // Fallback to JWT (Service Account)
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
    console.log("=== 检查 Charge to Project 列 ===\n");

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

    if (projectCodeIdx === -1) {
        console.error("❌ Projects 表中找不到 'Project Code' 列");
        return;
    }

    // 收集所有有效的 Project Code (小写，用于比较)
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
    const chargeToProjectIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'charge to project' || h.toLowerCase() === 'chargetoproject'
    );

    if (chargeToProjectIdx === -1) {
        console.error("❌ Main 表中找不到 'Charge to Project' 列");
        return;
    }

    console.log(`   Main 表共有 ${mainData.length - 1} 行数据\n`);

    // 3. 检查每一行的 Charge to Project
    console.log("[STEP 3] 检查无效的 Project Code...");
    const invalidRows = []; // 存储需要标记的行号 (1-based, 包括header)

    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const chargeToProject = norm(row[chargeToProjectIdx]);

        // 跳过空值
        if (!chargeToProject) continue;

        // 检查是否存在于有效的 Project Code 中
        if (!validProjectCodes.has(chargeToProject.toLowerCase())) {
            const rowNum = i + 1; // 转换为1-based行号
            invalidRows.push({
                rowNumber: rowNum,
                projectCode: chargeToProject,
                rowIndex: i
            });
        }
    }

    if (invalidRows.length === 0) {
        console.log("   ✅ 所有 Charge to Project 值都是有效的！\n");
        return;
    }

    console.log(`   ⚠️  发现 ${invalidRows.length} 行包含无效的 Project Code:\n`);
    invalidRows.forEach(r => {
        console.log(`   - 第 ${r.rowNumber} 行: "${r.projectCode}"`);
    });
    console.log("");

    // 4. 使用格式化 API 将这些行标记为黄色
    console.log("[STEP 4] 将无效行标记为黄色...");

    const mainSheetId = await getSheetId(sheets, MAIN_SHEET);

    // 构建批量更新请求
    const requests = invalidRows.map(r => ({
        repeatCell: {
            range: {
                sheetId: mainSheetId,
                startRowIndex: r.rowIndex,      // 0-based
                endRowIndex: r.rowIndex + 1,    // 不包含
                startColumnIndex: 0,
                endColumnIndex: mainHeaders.length
            },
            cell: {
                userEnteredFormat: {
                    backgroundColor: {
                        red: 1.0,       // Yellow color
                        green: 1.0,
                        blue: 0.0,
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
            requests: requests
        }
    });

    console.log(`   ✅ 已将 ${invalidRows.length} 行标记为黄色！\n`);

    // 5. 打印摘要
    console.log("=== 摘要 ===");
    console.log(`总行数: ${mainData.length - 1}`);
    console.log(`无效 Project Code 行数: ${invalidRows.length}`);
    console.log(`有效 Project Code 列表 (共 ${validProjectCodes.size} 个):`);
    [...validProjectCodes].sort().forEach(code => console.log(`   - ${code}`));
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
