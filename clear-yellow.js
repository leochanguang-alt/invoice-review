/**
 * 清除 Main 表中所有黄色背景标记
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
    console.log("=== 清除 Main 表所有黄色标记 ===\n");

    const auth = getDriveAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 获取 sheet ID
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties'
    });

    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === MAIN_SHEET);
    if (!sheet) {
        console.error(`Sheet "${MAIN_SHEET}" not found`);
        return;
    }
    const mainSheetId = sheet.properties.sheetId;
    const rowCount = sheet.properties.gridProperties.rowCount;
    const colCount = sheet.properties.gridProperties.columnCount;

    console.log(`Sheet: ${MAIN_SHEET}`);
    console.log(`行数: ${rowCount}, 列数: ${colCount}\n`);

    // 清除整个表的背景色（设置为白色）
    console.log("正在清除所有背景色...");

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            requests: [{
                repeatCell: {
                    range: {
                        sheetId: mainSheetId,
                        startRowIndex: 1,  // 从第2行开始 (跳过header)
                        endRowIndex: rowCount,
                        startColumnIndex: 0,
                        endColumnIndex: colCount
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
            }]
        }
    });

    console.log("✅ 已清除所有黄色标记！\n");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
