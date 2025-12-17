import {
  getSheetsClient, MAIN_SHEET, json,
  getHeaders, buildHeaderIndex, mustIdx,
  findFirstWaitingRow, getRowByColumns
} from "./_sheets.js";

export default async function handler(req, res) {
  try {
    const sheets = getSheetsClient();

    const headers = await getHeaders(sheets, MAIN_SHEET);
    const idx = buildHeaderIndex(headers);

    const required = [
      "ID", "Invoice_data", "Vendor", "amount", "currency",
      "Location(City)", "Country", "Category", "Status",
      "Charge to Company", "Charge to Project", "Final Link"
    ];

    const statusCol1 = mustIdx(idx, "Status") + 1;
    const rowNumber = await findFirstWaitingRow(sheets, MAIN_SHEET, statusCol1);
    if (!rowNumber) return json(res, 200, { success: true, data: null });

    const colIndexes1 = required.map(name => mustIdx(idx, name) + 1);
    const rowVals = await getRowByColumns(sheets, MAIN_SHEET, rowNumber, colIndexes1);

    const rec = { rowNumber };
    required.forEach((name, i) => (rec[name] = rowVals[i] ?? ""));

    return json(res, 200, { success: true, data: rec });
  } catch (e) {
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
