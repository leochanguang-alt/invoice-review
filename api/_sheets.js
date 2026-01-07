import { google } from "googleapis";

function cleanEnv(v) {
  if (!v) return "";
  v = v.trim();
  // Remove surrounding quotes
  if (v.startsWith('"') && v.endsWith('"')) {
    v = v.substring(1, v.length - 1);
  } else if (v.startsWith("'") && v.endsWith("'")) {
    v = v.substring(1, v.length - 1);
  }
  // Remove literal \n sequences at the end from shell copy-paste errors
  v = v.replace(/\\n$/, '');
  return v;
}

export const SHEET_ID = cleanEnv(process.env.SHEET_ID);
export const MAIN_SHEET = cleanEnv(process.env.MAIN_SHEET) || "Main";
export const LIST_SHEET = process.env.LIST_SHEET || "List";
export const WAITING_STATUS = process.env.WAITING_STATUS || "Waiting for Confirm";
export const CONFIRMED_STATUS = process.env.CONFIRMED_STATUS || "Confirmed";

export const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
export const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET);
export const GOOGLE_REFRESH_TOKEN = cleanEnv(process.env.GOOGLE_REFRESH_TOKEN);

export function norm(v) {
  return (v ?? "").toString().trim();
}

// 1->A, 27->AA
export function toA1Column(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function getSheetsClient() {
  const auth = getDriveAuth();
  return google.sheets({ version: "v4", auth });
}

export function getDriveAuth() {
  console.log("[DEBUG] getDriveAuth - GOOGLE_REFRESH_TOKEN present:", !!GOOGLE_REFRESH_TOKEN);
  // Try OAuth2 First (Refesh Token)
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    console.log("[DEBUG] getDriveAuth - Using OAuth2");
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    return oauth2Client;
  }

  console.log("[DEBUG] getDriveAuth - Falling back to Service Account");
  // Fallback to JWT (Service Account)
  const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  const email = cleanEnv(rawEmail);
  let key = cleanEnv(rawKey);

  if (!email || !key) {
    throw new Error("Missing auth env: Need OAuth2 (GOOGLE_REFRESH_TOKEN) OR Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL)");
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

export async function getHeaders(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!1:1`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return res.data.values?.[0] || [];
}

export function buildHeaderIndex(headers) {
  const m = new Map();
  headers.forEach((h, i) => m.set(norm(h), i)); // 0-based
  return m;
}

export function mustIdx(idx, name) {
  const i = idx.get(name);
  if (i == null) throw new Error(`Missing column: ${name}`);
  return i;
}

export async function findFirstWaitingRow(sheets, sheetName, statusCol1Based) {
  const col = toA1Column(statusCol1Based);
  const range = `${sheetName}!${col}2:${col}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const values = res.data.values || [];
  for (let i = 0; i < values.length; i++) {
    if (norm(values[i]?.[0]) === WAITING_STATUS) return i + 2; // 从第2行开始
  }
  return null;
}

export async function getRowByColumns(sheets, sheetName, rowNumber, colIndexes1Based) {
  const ranges = colIndexes1Based.map((ci) => {
    const c = toA1Column(ci);
    return `${sheetName}!${c}${rowNumber}:${c}${rowNumber}`;
  });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const vrs = res.data.valueRanges || [];
  return vrs.map(vr => vr.values?.[0]?.[0] ?? "");
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
