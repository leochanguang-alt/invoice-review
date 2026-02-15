/**
 * Automation script: Create project folders on Google Drive and sync links to Google Sheets
 * 
 * Usage: node create-project-folders.js
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const PROJECTS_SHEET = 'Projects';
const PARENT_FOLDER_ID = '14cHbyYH-wZSHfFHS-5aY-x7zw2bip2lD';

// Clean environment variables
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

// Get Auth client
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

// Convert column number to A1 format
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

    console.log('Reading Projects sheet...');
    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${PROJECTS_SHEET}!A:Z`,
    });

    const values = dataRes.data.values || [];
    if (values.length === 0) {
        console.log('Projects sheet is empty');
        return;
    }

    const headers = values[0].map(h => h.trim());
    const projectCodeIdx = headers.findIndex(h => h.toLowerCase().includes('project code') || h.toLowerCase().includes('project_code'));
    let linkColIdx = headers.findIndex(h => h === 'Drive_Folder_Link');

    if (projectCodeIdx === -1) {
        console.error('Cannot find Project Code column!');
        return;
    }

    // If no Link column, add one at the end
    if (linkColIdx === -1) {
        console.log('Drive_Folder_Link column not found, preparing to add.');
        linkColIdx = headers.length;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${PROJECTS_SHEET}!${toA1Column(linkColIdx + 1)}1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['Drive_Folder_Link']] }
        });
    }

    console.log(`Project Code column: ${toA1Column(projectCodeIdx + 1)}, Link column: ${toA1Column(linkColIdx + 1)}`);

    // 1. Create or find 'projects' top-level folder
    let projectsFolderId;
    const listRes = await drive.files.list({
        q: `name = 'projects' and '${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)',
    });

    if (listRes.data.files.length > 0) {
        projectsFolderId = listRes.data.files[0].id;
        console.log(`Found existing projects folder: ${projectsFolderId}`);
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
        console.log(`Created top-level projects folder: ${projectsFolderId}`);
    }

    // 2. Iterate rows and create folders
    const updates = [];
    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const projectCode = (row[projectCodeIdx] || '').trim();
        const existingLink = (row[linkColIdx] || '').trim();

        if (projectCode && !existingLink) {
            console.log(`  Creating folder for project ${projectCode}...`);

            // Check if subfolder already exists
            const subListRes = await drive.files.list({
                q: `name = '${projectCode}' and '${projectsFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, webViewLink)',
            });

            let folderLink = '';
            if (subListRes.data.files.length > 0) {
                folderLink = subListRes.data.files[0].webViewLink;
                console.log(`    Folder already exists: ${folderLink}`);
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
                console.log(`    Created successfully: ${folderLink}`);
            }

            if (folderLink) {
                updates.push({
                    range: `${PROJECTS_SHEET}!${toA1Column(linkColIdx + 1)}${i + 1}`,
                    values: [[folderLink]]
                });
            }
        }
    }

    // 3. Batch update Sheets
    if (updates.length > 0) {
        console.log(`Updating ${updates.length} links to Google Sheets...`);
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates,
            },
        });
        console.log('✅ All done!');
    } else {
        console.log('No records need updating.');
    }
}

main().catch(console.error);
