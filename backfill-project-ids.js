/**
 * One-time script: Fill in ProjectID for existing Projects table
 * 
 * Usage: node backfill-project-ids.js
 */

import 'dotenv/config';
import { google } from 'googleapis';

const SHEET_ID = process.env.SHEET_ID;
const PROJECTS_SHEET = 'Projects';

// Generate random 6-character uppercase letter ID
function generateRandomId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Clean environment variable
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

// Get Sheets client
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
    console.log('Connecting to Google Sheets...');
    const sheets = getSheetsClient();

    // Read all data
    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${PROJECTS_SHEET}!A:Z`,
        valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = dataRes.data.values || [];
    if (values.length === 0) {
        console.log('Projects sheet is empty');
        return;
    }

    const headers = values[0].map(h => h.trim().toLowerCase());
    const projectIdColIdx = headers.findIndex(h => h === 'projectid' || h === 'project id' || h === 'project_id');

    if (projectIdColIdx === -1) {
        console.error('Cannot find ProjectID column! Please check header.');
        return;
    }

    console.log(`ProjectID column position: column ${projectIdColIdx + 1} (${toA1Column(projectIdColIdx + 1)})`);

    // Collect existing IDs
    const existingIds = new Set();
    for (let i = 1; i < values.length; i++) {
        const id = (values[i][projectIdColIdx] || '').trim().toUpperCase();
        if (id) existingIds.add(id);
    }

    console.log(`Existing ID count: ${existingIds.size}`);

    // Find rows that need to be filled
    const updates = [];
    for (let i = 1; i < values.length; i++) {
        const currentId = (values[i][projectIdColIdx] || '').trim();
        if (!currentId) {
            // Generate unique ID
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
            console.log(`  Row ${rowNumber}: Generated ID -> ${newId}`);
        }
    }

    if (updates.length === 0) {
        console.log('All rows already have ProjectID, no update needed.');
        return;
    }

    console.log(`\nPreparing to update ${updates.length} rows...`);

    // Batch update
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates
        }
    });

    console.log('✅ Done! All empty ProjectIDs have been filled.');
}

main().catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
});
