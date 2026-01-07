import { getSheetsClient, SHEET_ID, MAIN_SHEET, norm, json, buildHeaderIndex } from "./_sheets.js";

export default async function handler(req, res) {
    try {
        const sheets = getSheetsClient();

        // Fetch header and data
        const dataRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${MAIN_SHEET}!A:Z`,
            valueRenderOption: "FORMATTED_VALUE",
        });

        const values = dataRes.data.values || [];
        if (values.length === 0) {
            return json(res, 200, { success: true, data: [] });
        }

        const headers = values[0].map(norm);
        const headerMap = buildHeaderIndex(headers);

        const result = [];
        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            const item = {};

            // Actual columns from Google Sheet -> Display names
            const columnMapping = {
                "Invoice Date": ["Invoice_data", "Invoice Date", "Date"],
                "Vender": ["Vendor", "Vender"],
                "Amount": ["amount", "Amount"],
                "Currency": ["currency", "Currency"],
                "Amount(HKD)": ["Amount (HKD)", "Amount(HKD)", "Amount_HKD"],
                "Country": ["Country"],
                "Category": ["Category"],
                "Status": ["Status"],
                "Charge to Company": ["Charge to Company"],
                "Charge to Project": ["Charge to Project"],
                "Owner": ["Owner"],
                "Invoice ID": ["Invoice_ID", "Invoice ID", "invoice_number"],
                "file_link": ["file_link", "Attachment", "Link"],
                "Location(City)": ["Location(City)", "Location"],
                "Drive_ID": [", OvC", "File_ID", "ID", "file_id", "Drive_ID"]
            };

            // For each display column, try to find a matching header
            for (const [displayName, possibleHeaders] of Object.entries(columnMapping)) {
                let value = "";
                for (const header of possibleHeaders) {
                    const idx = headerMap.get(header);
                    if (idx !== undefined) {
                        value = norm(row[idx]);
                        break;
                    }
                }
                item[displayName] = value;
            }

            // Include original row number for updates
            item._rowNumber = i + 1;

            // Only add if there is at least some data
            if (Object.values(item).some(v => v !== "")) {
                result.push(item);
            }
        }

        return json(res, 200, {
            success: true,
            data: result
        });
    } catch (e) {
        console.error("API Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
