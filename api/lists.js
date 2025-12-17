import { getSheetsClient, SHEET_ID, LIST_SHEET, norm, json } from "./_sheets.js";

export default async function handler(req, res) {
  try {
    const sheets = getSheetsClient();

    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${LIST_SHEET}!A:Z`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = data.data.values || [];
    if (values.length < 2) return json(res, 200, { success: true, companies: [], projects: [] });

    const headers = values[0].map(norm);
    const idxCompany = headers.indexOf("Company_Name");
    const idxProject = headers.indexOf("Project_Name");
    if (idxCompany < 0) throw new Error("List missing column: Company_Name");
    if (idxProject < 0) throw new Error("List missing column: Project_Name");

    const companies = new Set();
    const projects = new Set();

    for (let r = 1; r < values.length; r++) {
      const row = values[r] || [];
      const c = norm(row[idxCompany]);
      const p = norm(row[idxProject]);
      if (c) companies.add(c);
      if (p) projects.add(p);
    }

    return json(res, 200, {
      success: true,
      companies: [...companies].sort(),
      projects: [...projects].sort(),
    });
  } catch (e) {
    return json(res, 500, { success: false, message: e?.message || String(e) });
  }
}
