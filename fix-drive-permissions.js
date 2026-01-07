/**
 * 检查并修复 Drive 文件的共享权限
 * 新上传的文件需要设置为"知道链接的人可查看"才能在 iframe 中预览
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
    console.log("=== 检查并修复 Drive 文件共享权限 ===\n");

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

    if (driveIdIdx === -1) {
        console.error("❌ Main 表中找不到 'Drive_ID' 或 'File_ID' 列");
        return;
    }

    // 收集最后 20 条记录的 Drive_ID（新添加的记录）
    const recentRecords = [];
    for (let i = Math.max(1, mainData.length - 20); i < mainData.length; i++) {
        const row = mainData[i] || [];
        const driveId = norm(row[driveIdIdx]);
        if (driveId && !driveId.startsWith('msg_')) {
            recentRecords.push({
                rowNumber: i + 1,
                driveId
            });
        }
    }

    console.log(`   检查最近 ${recentRecords.length} 条记录的文件权限...\n`);

    // 2. 检查并修复每个文件的权限
    let fixed = 0;
    let alreadyShared = 0;
    let errors = 0;

    for (const item of recentRecords) {
        try {
            // 获取当前权限
            const permissionsRes = await drive.permissions.list({
                fileId: item.driveId,
                fields: 'permissions(id, type, role)',
                supportsAllDrives: true
            });

            const permissions = permissionsRes.data.permissions || [];
            const hasPublicAccess = permissions.some(p => p.type === 'anyone');

            if (hasPublicAccess) {
                console.log(`   ✓ 第 ${item.rowNumber} 行: 已有公开访问权限`);
                alreadyShared++;
            } else {
                // 添加公开访问权限
                console.log(`   → 第 ${item.rowNumber} 行: 添加公开访问权限...`);
                await drive.permissions.create({
                    fileId: item.driveId,
                    requestBody: {
                        type: 'anyone',
                        role: 'reader'
                    },
                    supportsAllDrives: true
                });
                console.log(`   ✓ 第 ${item.rowNumber} 行: 权限已添加`);
                fixed++;
            }
        } catch (err) {
            console.log(`   ✗ 第 ${item.rowNumber} 行: 错误 - ${err.message}`);
            errors++;
        }
    }

    // 3. 输出结果
    console.log("\n=== 结果 ===\n");
    console.log(`检查记录数: ${recentRecords.length}`);
    console.log(`已有公开权限: ${alreadyShared}`);
    console.log(`已修复权限: ${fixed}`);
    console.log(`错误: ${errors}`);

    if (fixed > 0) {
        console.log("\n✅ 权限已修复，请刷新页面重试预览！");
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
