import { supabase } from "./_supabase.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Table name mapping
const TABLE_MAP = {
    company: "companies",
    projects: "projects",
    owner: "owners",
    main: "invoices",
    currency_history: "currency_rates"
};

// R2 Configuration for project folder creation
const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: "Supabase client not initialized" });
        }

        if (req.method === "GET") {
            // List all rows from a table
            const tableKey = req.query.sheet;
            const tableName = TABLE_MAP[tableKey];

            if (!tableName) {
                return json(res, 400, { success: false, message: "Invalid table key" });
            }

            const sortCol = tableKey === 'currency_history' ? 'rate_date' : 'created_at';

            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .order(sortCol, { ascending: false });

            if (error) {
                console.error("[MANAGE] GET error:", error);
                return json(res, 500, { success: false, message: error.message });
            }

            // Map Supabase data to frontend format
            const result = (data || []).map(item => {
                const mapped = { _rowNumber: item.id };  // Use id as rowNumber for compatibility

                // Map based on table
                if (tableKey === 'company') {
                    mapped['Company_ID'] = item.company_id || '';
                    mapped['Company Name'] = item.company_name || '';
                    mapped['Country'] = item.country || '';
                    mapped['Company Contact'] = item.company_contact || '';
                } else if (tableKey === 'projects') {
                    mapped['Project_ID'] = item.project_id || '';
                    mapped['Project Code'] = item.project_code || '';
                    mapped['Project Name'] = item.project_name || '';
                    mapped['Company_ID'] = item.company_id || '';
                    mapped['Create Date'] = item.create_date || '';
                    mapped['End Date'] = item.end_date || '';
                    mapped['Project Owner'] = item.project_owner || '';
                    mapped['Drive_Folder_Link'] = item.drive_folder_link || '';
                } else if (tableKey === 'owner') {
                    mapped['Owner ID'] = item.owner_id || '';
                    mapped['Owner'] = item.owner_name || '';
                    mapped['First Name'] = item.first_name || '';
                    mapped['Last Name'] = item.last_name || '';
                    mapped['Company'] = item.company || '';
                    mapped['Mobile'] = item.mobile || '';
                    mapped['Bank Account'] = item.bank_account || '';
                } else if (tableKey === 'currency_history') {
                    mapped['Currency Code'] = item.currency_code || '';
                    mapped['Date'] = item.rate_date || '';
                    mapped['Rate to HKD'] = item.rate_to_hkd || '';
                } else {
                    // For main/invoices, return all fields
                    Object.assign(mapped, item);
                }

                return mapped;
            });

            // Extract headers from first item
            const headers = result.length > 0 ? Object.keys(result[0]).filter(k => k !== '_rowNumber') : [];

            return json(res, 200, { success: true, headers, data: result });

        } else if (req.method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
            const { action, sheet: tableKey, rowNumber, data } = body;
            const tableName = TABLE_MAP[tableKey];

            if (!tableName) {
                return json(res, 400, { success: false, message: "Invalid table key" });
            }

            if (action === "add") {
                // Map frontend field names to Supabase column names
                let insertData = {};

                if (tableKey === 'company') {
                    insertData = {
                        company_id: data['Company_ID'] || data['company_id'],
                        company_name: data['Company Name'] || data['company_name'],
                        country: data['Country'] || data['country'],
                        company_contact: data['Company Contact'] || data['company_contact']
                    };
                } else if (tableKey === 'projects') {
                    const projectCode = data['Project Code'] || data['project_code'] || '';
                    const projectName = data['Project Name'] || data['project_name'] || '';

                    insertData = {
                        project_id: data['Project_ID'] || data['project_id'],
                        project_code: projectCode,
                        project_name: projectName,
                        company_id: data['Company_ID'] || data['company_id'],
                        create_date: data['Create Date'] || data['create_date'] || null,
                        end_date: data['End Date'] || data['end_date'] || null,
                        project_owner: data['Project Owner'] || data['project_owner']
                    };

                    // Create R2 project folder (as a placeholder file)
                    const folderName = projectCode || projectName || 'Unknown_Project';
                    if (folderName && r2 && BUCKET_NAME) {
                        try {
                            const r2FolderPath = `bui_invoice/projects/${folderName}/.placeholder`;
                            await r2.send(new PutObjectCommand({
                                Bucket: BUCKET_NAME,
                                Key: r2FolderPath,
                                Body: '',
                                ContentType: 'text/plain'
                            }));

                            // Set the folder link to R2 path
                            insertData.drive_folder_link = `${R2_PUBLIC_URL}/${BUCKET_NAME}/bui_invoice/projects/${folderName}/`;
                            console.log(`[MANAGE] Created R2 folder: ${r2FolderPath}`);
                        } catch (r2Err) {
                            console.error("[MANAGE] R2 folder creation failed:", r2Err.message);
                        }
                    }
                } else if (tableKey === 'owner') {
                    insertData = {
                        owner_id: data['Owner ID'] || data['owner_id'],
                        owner_name: data['Owner'] || data['owner_name'],
                        first_name: data['First Name'] || data['first_name'],
                        last_name: data['Last Name'] || data['last_name'],
                        company: data['Company'] || data['company'],
                        mobile: data['Mobile'] || data['mobile'],
                        bank_account: data['Bank Account'] || data['bank_account']
                    };
                } else if (tableKey === 'main') {
                    insertData = mapInvoiceData(data);
                }

                const { error } = await supabase.from(tableName).insert([insertData]);

                if (error) {
                    console.error("[MANAGE] INSERT error:", error);
                    return json(res, 500, { success: false, message: error.message });
                }

                return json(res, 200, { success: true, message: "Row added" });

            } else if (action === "update") {
                const recordId = rowNumber; // rowNumber is actually Supabase id
                if (!recordId) {
                    return json(res, 400, { success: false, message: "Missing record ID" });
                }

                // Map frontend field names to Supabase column names for update
                let updateData = { updated_at: new Date().toISOString() };

                if (tableKey === 'main') {
                    updateData = { ...updateData, ...mapInvoiceData(data) };
                } else if (tableKey === 'company') {
                    if (data['Company Name'] !== undefined) updateData.company_name = data['Company Name'];
                    if (data['Country'] !== undefined) updateData.country = data['Country'];
                    if (data['Company Contact'] !== undefined) updateData.company_contact = data['Company Contact'];
                } else if (tableKey === 'projects') {
                    if (data['Project Name'] !== undefined) updateData.project_name = data['Project Name'];
                    if (data['Project Code'] !== undefined) updateData.project_code = data['Project Code'];
                    if (data['Company_ID'] !== undefined) updateData.company_id = data['Company_ID'];
                    if (data['Project Owner'] !== undefined) updateData.project_owner = data['Project Owner'];
                } else if (tableKey === 'owner') {
                    if (data['Owner'] !== undefined) updateData.owner_name = data['Owner'];
                    if (data['First Name'] !== undefined) updateData.first_name = data['First Name'];
                    if (data['Last Name'] !== undefined) updateData.last_name = data['Last Name'];
                    if (data['Company'] !== undefined) updateData.company = data['Company'];
                    if (data['Mobile'] !== undefined) updateData.mobile = data['Mobile'];
                }

                const { error } = await supabase
                    .from(tableName)
                    .update(updateData)
                    .eq('id', recordId);

                if (error) {
                    console.error("[MANAGE] UPDATE error:", error);
                    return json(res, 500, { success: false, message: error.message });
                }

                console.log(`[MANAGE] Updated ${tableName} record ${recordId}`);
                return json(res, 200, { success: true, message: "Row updated" });

            } else if (action === "delete") {
                const recordId = rowNumber;
                if (!recordId) {
                    return json(res, 400, { success: false, message: "Missing record ID" });
                }

                const { error } = await supabase
                    .from(tableName)
                    .delete()
                    .eq('id', recordId);

                if (error) {
                    console.error("[MANAGE] DELETE error:", error);
                    return json(res, 500, { success: false, message: error.message });
                }

                return json(res, 200, { success: true, message: "Row deleted" });
            }

            return json(res, 400, { success: false, message: "Invalid action" });
        }

        return json(res, 405, { error: "Method not allowed" });
    } catch (e) {
        console.error("[MANAGE] Error:", e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}

// Helper function to map invoice data from frontend to Supabase format
function mapInvoiceData(data) {
    const mapped = {};

    // Map common field name variations
    if (data['Invoice_data'] !== undefined || data['Invoice Date'] !== undefined) {
        mapped.invoice_date = data['Invoice_data'] || data['Invoice Date'];
    }
    if (data['Vendor'] !== undefined || data['Vender'] !== undefined) {
        mapped.vendor = data['Vendor'] || data['Vender'];
    }
    if (data['amount'] !== undefined || data['Amount'] !== undefined) {
        const amt = data['amount'] || data['Amount'];
        mapped.amount = typeof amt === 'string' ? parseFloat(amt.replace(/,/g, '')) : amt;
    }
    if (data['currency'] !== undefined || data['Currency'] !== undefined) {
        mapped.currency = data['currency'] || data['Currency'];
    }
    if (data['Amount (HKD)'] !== undefined || data['Amount(HKD)'] !== undefined) {
        const hkd = data['Amount (HKD)'] || data['Amount(HKD)'];
        if (hkd && hkd !== 'n/a') {
            mapped.amount_hkd = typeof hkd === 'string' ? parseFloat(hkd.replace(/,/g, '')) : hkd;
        }
    }
    if (data['Country'] !== undefined) mapped.country = data['Country'];
    if (data['Category'] !== undefined) mapped.category = data['Category'];
    if (data['Status'] !== undefined) mapped.status = data['Status'];
    if (data['Charge to Company'] !== undefined) mapped.charge_to_company = data['Charge to Company'];
    if (data['Charge to Project'] !== undefined) mapped.charge_to_project = data['Charge to Project'];
    if (data['Owner'] !== undefined) mapped.owner_name = data['Owner'];
    if (data['Location(City)'] !== undefined) mapped.location_city = data['Location(City)'];

    return mapped;
}
