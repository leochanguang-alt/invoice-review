/**
 * 检查 Main 表中所有 Drive_ID 是否有效
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
    throw new Error("Missing OAuth2 credentials");
}

async function main() {
    console.log("=== 检查 Drive_ID 有效性 ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // 1. 获取 Main 表数据
    console.log("[STEP 1] 读取 Main 表...");
    const mainRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${MAIN_SHEET}!A:Z`,
        valueRenderOption: 'FORMATTED_VALUE'
    });

    const mainData = mainRes.data.values || [];
    const mainHeaders = (mainData[0] || []).map(norm);

    const driveIdIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'drive_id' || h.toLowerCase() === 'file_id'
    );
    const vendorIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'vendor' || h.toLowerCase() === 'vender'
    );
    const amountIdx = mainHeaders.findIndex(h =>
        h.toLowerCase() === 'amount'
    );

    if (driveIdIdx === -1) {
        console.error("❌ Main 表中找不到 'Drive_ID' 或 'File_ID' 列");
        return;
    }

    console.log(`   找到 Drive_ID 列索引: ${driveIdIdx}`);
    console.log(`   Main 表共有 ${mainData.length - 1} 行数据\n`);

    // 2. 收集所有 Drive_ID
    const driveIds = [];
    for (let i = 1; i < mainData.length; i++) {
        const row = mainData[i] || [];
        const driveId = norm(row[driveIdIdx]);
        if (driveId) {
            driveIds.push({
                rowNumber: i + 1,
                driveId,
                vendor: norm(row[vendorIdx]),
                amount: norm(row[amountIdx])
            });
        }
    }

    console.log(`[STEP 2] 检查 ${driveIds.length} 个 Drive_ID...\n`);

    // 3. 检查每个 Drive_ID
    const invalid = [];
    const valid = [];
    let checked = 0;

    for (const item of driveIds) {
        checked++;
        if (checked % 50 === 0) {
            console.log(`   已检查 ${checked}/${driveIds.length}...`);
        }

        try {
            const file = await drive.files.get({
                fileId: item.driveId,
                fields: 'id, name, mimeType, trashed',
                supportsAllDrives: true
            });

            if (file.data.trashed) {
                invalid.push({
                    ...item,
                    reason: '文件已被删除（在回收站中）'
                });
            } else {
                valid.push(item);
            }
        } catch (err) {
            invalid.push({
                ...item,
                reason: err.message || '无法访问文件'
            });
        }
    }

    // 4. 输出结果
    console.log("\n=== 检查结果 ===\n");
    console.log(`总记录数: ${mainData.length - 1}`);
    console.log(`有 Drive_ID: ${driveIds.length}`);
    console.log(`无 Drive_ID: ${mainData.length - 1 - driveIds.length}`);
    console.log(`有效 Drive_ID: ${valid.length}`);
    console.log(`无效 Drive_ID: ${invalid.length}\n`);

    if (invalid.length === 0) {
        console.log("✅ 所有 Drive_ID 都是有效的！\n");
    } else {
        console.log("⚠️  发现以下无效的 Drive_ID:\n");
        invalid.slice(0, 20).forEach(item => {
            console.log(`   第 ${item.rowNumber} 行:`);
            console.log(`      Drive_ID: ${item.driveId}`);
            console.log(`      Vendor: ${item.vendor}, Amount: ${item.amount}`);
            console.log(`      原因: ${item.reason}`);
            console.log("");
        });

        if (invalid.length > 20) {
            console.log(`   ... 还有 ${invalid.length - 20} 个无效的 Drive_ID\n`);
        }
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
