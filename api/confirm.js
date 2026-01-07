import {
  getSheetsClient, MAIN_SHEET, CONFIRMED_STATUS, json,
  getHeaders, buildHeaderIndex, mustIdx, toA1Column, SHEET_ID
} from "./_sheets.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { success: false, message: "POST only" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const rowNumber = Number(body.rowNumber);
    const chargeToCompany = body.chargeToCompany;
    const chargeToProject = body.chargeToProject;

    if (!rowNumber) return json(res, 400, { success: false, message: "Missing rowNumber" });

    const sheets = getSheetsClient();
    const headers = await getHeaders(sheets, MAIN_SHEET);
    const idx = buildHeaderIndex(headers);

    const cStatus = mustIdx(idx, "Status") + 1;
    const updates = [
      { col: cStatus, value: CONFIRMED_STATUS }
    ];

    // Optional updates if provided
    if (chargeToCompany) {
      const cCompany = mustIdx(idx, "Charge to Company") + 1;
      updates.push({ col: cCompany, value: chargeToCompany });
    }
    if (chargeToProject) {
      const cProject = mustIdx(idx, "Charge to Project") + 1;
      updates.push({ col: cProject, value: chargeToProject });
    }

    const batchUpdates = updates.map(u => {
      const c = toA1Column(u.col);
      return { range: `${MAIN_SHEET}!${c}${rowNumber}:${c}${rowNumber}`, values: [[u.value]] };
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data: batchUpdates },
    });

    return json(res, 200, { success: true });
  } catch (e) {
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
