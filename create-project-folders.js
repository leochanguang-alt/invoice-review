/**
 * 自动化脚本：在 Google Drive 上为项目创建文件夹并同步链接到 Google Sheets
 * 
 * 用法: node create-project-folders.js
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const PROJECTS_SHEET = 'Projects';
const PARENT_FOLDER_ID = '14cHbyYH-wZSHfFHS-5aY-x7zw2bip2lD';

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

// 获取 Auth 客户端
function getAuth() {
    const email = cleanEnv(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    let key = cleanEnv(process.env.GOOGLE_PRIVATE_KEY);
    key = key.replace(/\\n/g, '\n');

    return new google.auth.JWT({
        email,
        key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive'
        ],
    });
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
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    console.log('正在读取 Projects 表...');
    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${PROJECTS_SHEET}!A:Z`,
    });

    const values = dataRes.data.values || [];
    if (values.length === 0) {
        console.log('Projects 表为空');
        return;
    }

    const headers = values[0].map(h => h.trim());
    const projectCodeIdx = headers.findIndex(h => h.toLowerCase().includes('project code') || h.toLowerCase().includes('project_code'));
    let linkColIdx = headers.findIndex(h => h === 'Drive_Folder_Link');

    if (projectCodeIdx === -1) {
        console.error('找不到 Project Code 列！');
        return;
    }

    // 如果没有 Link 列，则在最后添加一列
    if (linkColIdx === -1) {
        console.log('未找到 Drive_Folder_Link 列，准备新增。');
        linkColIdx = headers.length;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${PROJECTS_SHEET}!${toA1Column(linkColIdx + 1)}1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Drive_Folder_Link']] }
        });
    }

    console.log(`Project Code 列: ${toA1Column(projectCodeIdx + 1)}, Link 列: ${toA1Column(linkColIdx + 1)}`);

    // 1. 创建或查找 'projects' 顶级文件夹
    let projectsFolderId;
    const listRes = await drive.files.list({
        q: `name = 'projects' and '${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)',
    });

    if (listRes.data.files.length > 0) {
        projectsFolderId = listRes.data.files[0].id;
        console.log(`找到已存在的 projects 文件夹: ${projectsFolderId}`);
    } else {
        const createRes = await drive.files.create({
            requestBody: {
                name: 'projects',
                mimeType: 'application/vnd.google-apps.folder',
                parents: [PARENT_FOLDER_ID],
            },
            fields: 'id',
        });
        projectsFolderId = createRes.data.id;
        console.log(`创建了顶级 projects 文件夹: ${projectsFolderId}`);
    }

    // 2. 遍历行并创建文件夹
    const updates = [];
    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const projectCode = (row[projectCodeIdx] || '').trim();
        const existingLink = (row[linkColIdx] || '').trim();

        if (projectCode && !existingLink) {
            console.log(`  正在为项目 ${projectCode} 创建文件夹...`);

            // 检查子文件夹是否已存在
            const subListRes = await drive.files.list({
                q: `name = '${projectCode}' and '${projectsFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, webViewLink)',
            });

            let folderLink = '';
            if (subListRes.data.files.length > 0) {
                folderLink = subListRes.data.files[0].webViewLink;
                console.log(`    文件夹已存在: ${folderLink}`);
            } else {
                const subCreateRes = await drive.files.create({
                    requestBody: {
                        name: projectCode,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [projectsFolderId],
                    },
                    fields: 'id, webViewLink',
                });
                folderLink = subCreateRes.data.webViewLink;
                console.log(`    创建成功: ${folderLink}`);
            }

            if (folderLink) {
                updates.push({
                    range: `${PROJECTS_SHEET}!${toA1Column(linkColIdx + 1)}${i + 1}`,
                    values: [[folderLink]]
                });
            }
        }
    }

    // 3. 批量更新 Sheets
    if (updates.length > 0) {
        console.log(`正在更新 ${updates.length} 条链接到 Google Sheets...`);
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates,
            },
        });
        console.log('✅ 全部完成！');
    } else {
        console.log('没有需要更新的记录。');
    }
}

main().catch(console.error);
