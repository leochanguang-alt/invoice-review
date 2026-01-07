/**
 * 检查 Google Drive 中的项目文件夹名称是否与 Projects 表中的 Project Code 匹配
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

const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

// Invoice 归档的父文件夹 ID
const ARCHIVE_PARENT_ID = '1FreZ79xZvK3S1_Zlg4oyaep0-1tkXwF8';

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

async function main() {
    console.log("=== 检查 Google Drive 项目文件夹 ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

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
    const folderLinkIdx = projectsHeaders.findIndex(h =>
        h.toLowerCase().includes('drive') && h.toLowerCase().includes('folder')
    );

    const projectCodes = new Map(); // code -> {row, folderLink}
    for (let i = 1; i < projectsData.length; i++) {
        const code = norm(projectsData[i]?.[projectCodeIdx]);
        const folderLink = norm(projectsData[i]?.[folderLinkIdx]);
        if (code) {
            projectCodes.set(code.toLowerCase(), {
                code,
                row: i + 1,
                folderLink
            });
        }
    }
    console.log(`   找到 ${projectCodes.size} 个 Project Code:\n`);
    for (const [key, val] of projectCodes) {
        console.log(`   - ${val.code}`);
        if (val.folderLink) {
            console.log(`     链接: ${val.folderLink}`);
        }
    }
    console.log("");

    // 2. 列出 Google Drive 中归档文件夹下的所有子文件夹
    console.log("[STEP 2] 读取 Google Drive 归档文件夹...");

    const foldersRes = await drive.files.list({
        q: `'${ARCHIVE_PARENT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
        orderBy: 'name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    const driveFolders = foldersRes.data.files || [];
    console.log(`   找到 ${driveFolders.length} 个文件夹:\n`);

    const driveFolderNames = new Map(); // name.toLowerCase() -> {name, id, link}
    for (const folder of driveFolders) {
        console.log(`   - ${folder.name} (ID: ${folder.id})`);
        driveFolderNames.set(folder.name.toLowerCase(), {
            name: folder.name,
            id: folder.id,
            link: folder.webViewLink
        });
    }
    console.log("");

    // 3. 比较
    console.log("[STEP 3] 比较 Project Code 和文件夹名称...\n");

    const issues = [];

    // 检查每个 Project Code 是否有对应的文件夹
    for (const [key, project] of projectCodes) {
        if (!driveFolderNames.has(key)) {
            issues.push({
                type: 'MISSING_FOLDER',
                projectCode: project.code,
                message: `Project Code "${project.code}" 在 Google Drive 中没有对应的文件夹`
            });
        }
    }

    // 检查每个文件夹是否有对应的 Project Code
    for (const [key, folder] of driveFolderNames) {
        if (!projectCodes.has(key)) {
            issues.push({
                type: 'EXTRA_FOLDER',
                folderName: folder.name,
                folderId: folder.id,
                message: `文件夹 "${folder.name}" 在 Projects 表中没有对应的 Project Code`
            });
        }
    }

    // 检查名称大小写是否完全匹配
    for (const [key, project] of projectCodes) {
        const folder = driveFolderNames.get(key);
        if (folder && folder.name !== project.code) {
            issues.push({
                type: 'CASE_MISMATCH',
                projectCode: project.code,
                folderName: folder.name,
                message: `大小写不匹配: Project Code "${project.code}" vs 文件夹名 "${folder.name}"`
            });
        }
    }

    // 4. 输出结果
    console.log("=== 检查结果 ===\n");
    console.log(`Projects 表中的 Project Code: ${projectCodes.size}`);
    console.log(`Google Drive 中的文件夹: ${driveFolders.length}`);
    console.log(`发现问题: ${issues.length}\n`);

    if (issues.length === 0) {
        console.log("✅ 所有 Project Code 和文件夹名称完全匹配！\n");
    } else {
        console.log("⚠️  发现以下问题:\n");

        const missingFolders = issues.filter(i => i.type === 'MISSING_FOLDER');
        const extraFolders = issues.filter(i => i.type === 'EXTRA_FOLDER');
        const caseMismatches = issues.filter(i => i.type === 'CASE_MISMATCH');

        if (missingFolders.length > 0) {
            console.log(`--- 缺少文件夹 (${missingFolders.length}) ---`);
            missingFolders.forEach(i => console.log(`   ${i.message}`));
            console.log("");
        }

        if (extraFolders.length > 0) {
            console.log(`--- 多余的文件夹 (${extraFolders.length}) ---`);
            extraFolders.forEach(i => console.log(`   ${i.message}`));
            console.log("");
        }

        if (caseMismatches.length > 0) {
            console.log(`--- 大小写不匹配 (${caseMismatches.length}) ---`);
            caseMismatches.forEach(i => console.log(`   ${i.message}`));
            console.log("");
        }
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
