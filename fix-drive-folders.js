/**
 * 修复 Google Drive 文件夹名称
 * 1. 重命名 BUI-Ski-Icshgl-2512 -> BUI-Ski-Icshgl
 * 2. 删除 Test_Folder_by_AI
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

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

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
    console.log("=== 修复 Google Drive 文件夹 ===\n");

    const auth = getDriveAuth();
    const drive = google.drive({ version: 'v3', auth });

    // 1. 重命名文件夹 BUI-Ski-Icshgl-2512 -> BUI-Ski-Icshgl
    const oldFolderId = '1Zxc2crtysmtOa_f0tk83Pq3_WZN9DWOG';
    const newName = 'BUI-Ski-Icshgl';

    console.log("[STEP 1] 重命名文件夹...");
    console.log(`   旧名称: BUI-Ski-Icshgl-2512`);
    console.log(`   新名称: ${newName}`);

    try {
        await drive.files.update({
            fileId: oldFolderId,
            requestBody: {
                name: newName
            },
            supportsAllDrives: true
        });
        console.log("   ✅ 重命名成功！\n");
    } catch (err) {
        console.error("   ❌ 重命名失败:", err.message);
    }

    // 2. 删除测试文件夹 Test_Folder_by_AI
    const testFolderId = '10gC5Pi47DhpPD310qpX_EzYD9GPUDZcY';

    console.log("[STEP 2] 删除测试文件夹...");
    console.log(`   文件夹: Test_Folder_by_AI`);

    try {
        await drive.files.delete({
            fileId: testFolderId,
            supportsAllDrives: true
        });
        console.log("   ✅ 删除成功！\n");
    } catch (err) {
        console.error("   ❌ 删除失败:", err.message);
    }

    console.log("=== 修复完成 ===\n");
    console.log("请重新运行 check-drive-folders.js 验证结果。");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
