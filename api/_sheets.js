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
export const MAIN_SHEET = cleanEnv(process.env.MAIN_SHEET) || "工作表1";
export const LIST_SHEET = process.env.LIST_SHEET || "List";
export const WAITING_STATUS = process.env.WAITING_STATUS || "Waiting for Confirm";
export const CONFIRMED_STATUS = process.env.CONFIRMED_STATUS || "Confirmed";

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
  const rawEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  const email = cleanEnv(rawEmail);
  let key = cleanEnv(rawKey);

  console.log(`[DEBUG] Auth Attempt - Email length: ${email.length}, SheetID: ${SHEET_ID}`);

  if (!SHEET_ID) throw new Error("Missing env: SHEET_ID");
  if (!email || !key) throw new Error("Missing env: GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");

  // Handle literal newlines and escaped \n
  key = key.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
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
