import { getSheetsClient, SHEET_ID, MAIN_SHEET, norm, json } from "./_sheets.js";

export default async function handler(req, res) {
    try {
        const sheets = getSheetsClient();

        const dataRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${MAIN_SHEET}!1:1`,
            valueRenderOption: "FORMATTED_VALUE",
        });

        const headers = (dataRes.data.values?.[0] || []).map(norm);

        return json(res, 200, {
            success: true,
            headers: headers
        });
    } catch (e) {
        console.error("API Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
