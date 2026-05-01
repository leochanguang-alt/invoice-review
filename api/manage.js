import { supabase } from "../lib/_supabase.js";
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { google } from "googleapis";
import { getDriveAuth } from "../lib/_sheets.js";

// Currency-Country linking helper
async function getCurrencyList() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('currency_list')
            .select('currency_code, Country');
        if (error) return [];
        return data || [];
    } catch {
        return [];
    }
}

function linkCurrencyCountry(data, currencyList) {
    if (!currencyList || currencyList.length === 0) return;

    const currency = (data.currency || '').toString().trim().toUpperCase();
    const country = (data.country || '').toString().trim();

    const hasCurrency = currency.length > 0;
    const hasCountry = country.length > 0;

    if (hasCurrency && !hasCountry) {
        // Note: column name is 'Country' (capital C) in database
        const row = currencyList.find(
            (r) => (r.currency_code || '').toString().trim().toUpperCase() === currency
        );
        if (row && row.Country) {
            data.country = (row.Country || '').toString().trim();
            console.log(`[MANAGE] Auto-linked currency ${currency} -> country ${data.country}`);
        }
    } else if (hasCountry && !hasCurrency) {
        const row = currencyList.find(
            (r) => (r.Country || '').toString().trim().toLowerCase() === country.toLowerCase()
        );
        if (row && row.currency_code) {
            data.currency = (row.currency_code || '').toString().trim().toUpperCase();
            console.log(`[MANAGE] Auto-linked country ${country} -> currency ${data.currency}`);
        }
    }
}

// Table name mapping
const TABLE_MAP = {
    company: "companies",
    projects: "projects",
    owner: "owners",
    main: "invoices",
    currency_history: "currency_rates"
};

// R2 Configuration for project folder creation
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''); // Remove trailing slashes

// Only create R2 client if all credentials are present
const r2 = (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) ? new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
}) : null;

// Helper function to create R2 project folder
async function createR2ProjectFolder(folderName) {
    if (!r2 || !BUCKET_NAME) {
        console.warn("[MANAGE] R2 client not configured, skipping folder creation");
        return null;
    }

    if (!folderName) {
        console.warn("[MANAGE] No folder name provided");
        return null;
    }

    const r2FolderPath = `bui_invoice/projects/${folderName}/.placeholder`;
    
    try {
        console.log(`[MANAGE] Creating R2 folder: ${r2FolderPath}`);
        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: r2FolderPath,
            Body: '',
            ContentType: 'text/plain'
        }));

        // Build the folder link
        const folderLink = R2_PUBLIC_URL 
            ? `${R2_PUBLIC_URL}/bui_invoice/projects/${folderName}/`
            : `https://${BUCKET_NAME}.r2.cloudflarestorage.com/bui_invoice/projects/${folderName}/`;
        
        console.log(`[MANAGE] R2 folder created successfully: ${folderLink}`);
        return folderLink;
    } catch (err) {
        console.error("[MANAGE] R2 folder creation failed:", err.message);
        throw err; // Re-throw to let caller handle it
    }
}

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
                // Use appropriate primary key based on table type
                let rowId;
                if (tableKey === 'company') {
                    rowId = item.company_id;
                } else if (tableKey === 'projects') {
                    rowId = item.project_id;
                } else if (tableKey === 'owner') {
                    rowId = item.owner_id;
                } else {
                    rowId = item.id;
                }
                const mapped = { _rowNumber: rowId };

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
                    mapped['Status'] = item.archived ? 'Achieved' : 'Active';
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

            // === FIX PROJECT FOLDERS ACTION ===
            if (action === "fix-folders") {
                if (!r2) {
                    return json(res, 500, { success: false, message: "R2 client not configured" });
                }

                const { project_id, force_all } = body;

                let query = supabase
                    .from('projects')
                    .select('project_id, project_code, project_name, drive_folder_link');

                if (project_id) {
                    query = query.eq('project_id', project_id);
                } else if (!force_all) {
                    query = query.or('drive_folder_link.is.null,drive_folder_link.eq.');
                }

                const { data: projects, error } = await query;

                if (error) {
                    return json(res, 500, { success: false, message: error.message });
                }

                if (!projects || projects.length === 0) {
                    return json(res, 200, { success: true, message: "No projects need fixing", fixed: 0 });
                }

                const results = [];
                let fixed = 0;
                let errors = 0;

                for (const project of projects) {
                    const folderName = project.project_code || project.project_name;
                    
                    if (!folderName) {
                        results.push({ project_id: project.project_id, status: 'skipped', reason: 'No project code or name' });
                        continue;
                    }

                    try {
                        const folderLink = await createR2ProjectFolder(folderName);
                        
                        if (folderLink) {
                            const { error: updateErr } = await supabase
                                .from('projects')
                                .update({ drive_folder_link: folderLink })
                                .eq('project_id', project.project_id);

                            if (updateErr) {
                                results.push({ project_id: project.project_id, project_code: folderName, status: 'error', reason: updateErr.message });
                                errors++;
                            } else {
                                results.push({ project_id: project.project_id, project_code: folderName, status: 'fixed', drive_folder_link: folderLink });
                                fixed++;
                            }
                        }
                    } catch (err) {
                        results.push({ project_id: project.project_id, project_code: folderName, status: 'error', reason: err.message });
                        errors++;
                    }
                }

                return json(res, 200, { 
                    success: true, 
                    message: `Fixed ${fixed} project(s), ${errors} error(s)`,
                    fixed,
                    errors,
                    results
                });
            }

            // === CHECK PROJECT FOLDERS ACTION ===
            if (action === "check-folders") {
                const { data: projects, error } = await supabase
                    .from('projects')
                    .select('project_id, project_code, project_name, drive_folder_link')
                    .order('project_code');

                if (error) {
                    return json(res, 500, { success: false, message: error.message });
                }

                const results = (projects || []).map(project => ({
                    project_id: project.project_id,
                    project_code: project.project_code,
                    project_name: project.project_name,
                    has_folder_link: !!project.drive_folder_link,
                    drive_folder_link: project.drive_folder_link || null
                }));

                const missing = results.filter(r => !r.has_folder_link);
                
                return json(res, 200, { 
                    success: true, 
                    total: results.length,
                    missing_count: missing.length,
                    projects: results
                });
            }

            // === REJECT INVOICES ACTION (must be before tableName validation) ===
            if (action === "reject-invoices") {
                const { invoiceIds, projectCode } = body;

                if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
                    return json(res, 400, { success: false, message: "No invoice IDs provided" });
                }

                console.log(`[MANAGE] Rejecting ${invoiceIds.length} invoices from project ${projectCode}`);

                // Initialize Google Drive client
                let drive = null;
                try {
                    const auth = getDriveAuth();
                    drive = google.drive({ version: "v3", auth });
                } catch (driveErr) {
                    console.warn(`[MANAGE] Could not initialize Google Drive client:`, driveErr.message);
                }

                const R2_ORIGINAL_PREFIX = 'bui_invoice/original_files/fr_google_drive';
                const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${BUCKET_NAME}.r2.dev`;

                let deletedCount = 0;
                let resyncedCount = 0;
                let updateErrors = [];

                for (const invoiceId of invoiceIds) {
                    try {
                        // 1. Get the invoice record to find file info
                        const { data: invoice, error: fetchError } = await supabase
                            .from('invoices')
                            .select('*')
                            .eq('generated_invoice_id', invoiceId)
                            .single();

                        if (fetchError) {
                            console.error(`[MANAGE] Could not find invoice ${invoiceId}:`, fetchError.message);
                            updateErrors.push({ id: invoiceId, error: fetchError.message });
                            continue;
                        }

                        // 2. Delete file from R2 project folder (achieved file)
                        if (r2 && BUCKET_NAME && projectCode && invoice) {
                            try {
                                // Get extension from achieved_file_link or file_link_r2
                                let fileExt = 'pdf';
                                if (invoice.achieved_file_link) {
                                    const ext = invoice.achieved_file_link.split('.').pop().split('?')[0];
                                    if (ext) fileExt = ext;
                                } else if (invoice.file_link_r2) {
                                    const ext = invoice.file_link_r2.split('.').pop().split('?')[0];
                                    if (ext) fileExt = ext;
                                }
                                const r2Key = `bui_invoice/projects/${projectCode}/${invoiceId}.${fileExt}`;

                                const deleteCommand = new DeleteObjectCommand({
                                    Bucket: BUCKET_NAME,
                                    Key: r2Key
                                });

                                await r2.send(deleteCommand);
                                console.log(`[MANAGE] Deleted R2 project file: ${r2Key}`);
                                deletedCount++;
                            } catch (r2Err) {
                                console.warn(`[MANAGE] Could not delete R2 project file for ${invoiceId}:`, r2Err.message);
                                // Continue even if R2 deletion fails
                            }
                        }

                        // 3. Restore original file to R2 from Google Drive
                        let newR2Link = null;
                        let newR2Hash = null;
                        const googleDriveFileId = invoice.file_id;
                        
                        if (googleDriveFileId && drive && r2 && BUCKET_NAME) {
                            try {
                                // Get file metadata from Google Drive
                                const fileMetadata = await drive.files.get({
                                    fileId: googleDriveFileId,
                                    fields: 'id, name, mimeType',
                                    supportsAllDrives: true
                                });
                                
                                const originalFileName = fileMetadata.data.name;
                                const mimeType = fileMetadata.data.mimeType;
                                const sanitizedName = (originalFileName || googleDriveFileId).replace(/[\\\/:*?"<>|]/g, '_').trim();
                                const r2Key = `${R2_ORIGINAL_PREFIX}/${sanitizedName}`;
                                
                                console.log(`[MANAGE] Syncing file from Google Drive: ${originalFileName} -> ${r2Key}`);

                                // Check if file already exists in R2 original folder
                                let fileExistsInR2 = false;
                                try {
                                    await r2.send(new HeadObjectCommand({
                                        Bucket: BUCKET_NAME,
                                        Key: r2Key
                                    }));
                                    fileExistsInR2 = true;
                                    console.log(`[MANAGE] File already exists in R2: ${r2Key}`);
                                } catch (headErr) {
                                    if (headErr.name !== 'NotFound' && headErr.$metadata?.httpStatusCode !== 404) {
                                        throw headErr;
                                    }
                                }

                                if (fileExistsInR2) {
                                    // File exists, just update the link
                                    newR2Link = `${R2_PUBLIC_URL}/${r2Key}`;
                                    console.log(`[MANAGE] Using existing R2 file: ${newR2Link}`);
                                } else {
                                    // Download from Google Drive and upload to R2
                                    const response = await drive.files.get(
                                        { fileId: googleDriveFileId, alt: "media" },
                                        { responseType: "stream" }
                                    );

                                    const upload = new Upload({
                                        client: r2,
                                        params: {
                                            Bucket: BUCKET_NAME,
                                            Key: r2Key,
                                            Body: response.data,
                                            ContentType: mimeType || 'application/octet-stream',
                                        },
                                    });

                                    const uploadResult = await upload.done();
                                    newR2Hash = uploadResult.ETag?.replace(/"/g, '') || null;
                                    newR2Link = `${R2_PUBLIC_URL}/${r2Key}`;
                                    console.log(`[MANAGE] Successfully uploaded to R2: ${r2Key}, ETag: ${newR2Hash}`);
                                    resyncedCount++;
                                }
                            } catch (syncErr) {
                                console.error(`[MANAGE] Failed to sync file from Google Drive for ${invoiceId}:`, syncErr.message);
                                // Continue even if sync fails - the record will still be rejected
                            }
                        }

                        // 4. Update invoice status and restore/clear fields
                        const updateData = {
                            status: 'waiting for confirm',
                            charge_to_project: null,
                            generated_invoice_id: null,
                            achieved_file_link: null,
                            achieved_file_id: null
                        };

                        // Restore file_link_r2 if we have a new R2 link
                        if (newR2Link) {
                            updateData.file_link_r2 = newR2Link;
                        }
                        if (newR2Hash) {
                            updateData.file_ID_HASH_R2 = newR2Hash;
                        }

                        const { error: updateError } = await supabase
                            .from('invoices')
                            .update(updateData)
                            .eq('id', invoice.id);

                        if (updateError) {
                            console.error(`[MANAGE] Failed to update invoice ${invoiceId}:`, updateError.message);
                            updateErrors.push({ id: invoiceId, error: updateError.message });
                        } else {
                            console.log(`[MANAGE] Invoice ${invoiceId} rejected successfully`);
                        }

                    } catch (err) {
                        console.error(`[MANAGE] Error processing invoice ${invoiceId}:`, err.message);
                        updateErrors.push({ id: invoiceId, error: err.message });
                    }
                }

                if (updateErrors.length === invoiceIds.length) {
                    return json(res, 500, { 
                        success: false, 
                        message: "All invoices failed to reject",
                        errors: updateErrors 
                    });
                }

                return json(res, 200, { 
                    success: true, 
                    message: `Successfully rejected ${invoiceIds.length - updateErrors.length} invoices`,
                    deletedR2Files: deletedCount,
                    resyncedFiles: resyncedCount,
                    errors: updateErrors.length > 0 ? updateErrors : undefined
                });
            }

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

                    // Create R2 project folder automatically
                    const folderName = projectCode || projectName;
                    if (folderName) {
                        try {
                            const folderLink = await createR2ProjectFolder(folderName);
                            if (folderLink) {
                                insertData.drive_folder_link = folderLink;
                                console.log(`[MANAGE] Project folder link set: ${folderLink}`);
                            } else {
                                console.warn(`[MANAGE] R2 folder not created (R2 not configured), continuing without folder link`);
                            }
                        } catch (r2Err) {
                            // Log error but don't fail the entire operation
                            console.error("[MANAGE] Failed to create R2 folder:", r2Err.message);
                            // Optionally: return error to frontend
                            // return json(res, 500, { success: false, message: `Failed to create project folder: ${r2Err.message}` });
                        }
                    } else {
                        console.warn("[MANAGE] No project code or name provided, skipping R2 folder creation");
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
                const recordId = rowNumber; // rowNumber is the primary key value
                if (!recordId) {
                    return json(res, 400, { success: false, message: "Missing record ID" });
                }

                // Determine the primary key column based on table
                let pkColumn = 'id';
                if (tableKey === 'company') pkColumn = 'company_id';
                else if (tableKey === 'projects') pkColumn = 'project_id';
                else if (tableKey === 'owner') pkColumn = 'owner_id';

                // Map frontend field names to Supabase column names for update
                // Note: not all tables have updated_at column
                let updateData = {};
                
                // Only add updated_at for tables that have this column
                if (tableKey !== 'projects') {
                    updateData.updated_at = new Date().toISOString();
                }

                if (tableKey === 'main') {
                    updateData = { ...updateData, ...mapInvoiceData(data) };
                    
                    // Auto-link currency and country for invoices
                    const currencyList = await getCurrencyList();
                    linkCurrencyCountry(updateData, currencyList);
                } else if (tableKey === 'company') {
                    if (data['Company Name'] !== undefined) updateData.company_name = data['Company Name'];
                    if (data['Country'] !== undefined) updateData.country = data['Country'];
                    if (data['Company Contact'] !== undefined) updateData.company_contact = data['Company Contact'];
                } else if (tableKey === 'projects') {
                    if (data['Project Name'] !== undefined) updateData.project_name = data['Project Name'];
                    if (data['Project Code'] !== undefined) updateData.project_code = data['Project Code'];
                    if (data['Company_ID'] !== undefined) updateData.company_id = data['Company_ID'];
                    if (data['Project Owner'] !== undefined) updateData.project_owner = data['Project Owner'];
                    // Handle Status field: convert 'Achieved'/'Active' to boolean archived
                    if (data['Status'] !== undefined) {
                        updateData.archived = data['Status'] === 'Achieved';
                    }
                    // Also support direct archived boolean (for Export page Archive button)
                    if (data['archived'] !== undefined) updateData.archived = data['archived'];

                    // Check if project needs R2 folder created (missing drive_folder_link)
                    const { data: existingProject } = await supabase
                        .from('projects')
                        .select('project_code, project_name, drive_folder_link')
                        .eq('project_id', recordId)
                        .single();

                    if (existingProject && !existingProject.drive_folder_link) {
                        const folderName = existingProject.project_code || existingProject.project_name;
                        if (folderName) {
                            try {
                                const folderLink = await createR2ProjectFolder(folderName);
                                if (folderLink) {
                                    updateData.drive_folder_link = folderLink;
                                    console.log(`[MANAGE] Created missing R2 folder for project ${folderName}: ${folderLink}`);
                                }
                            } catch (r2Err) {
                                console.error("[MANAGE] Failed to create R2 folder on update:", r2Err.message);
                            }
                        }
                    }
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
                    .eq(pkColumn, recordId);

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

                // Determine the primary key column based on table
                let pkColumn = 'id';
                if (tableKey === 'company') pkColumn = 'company_id';
                else if (tableKey === 'projects') pkColumn = 'project_id';
                else if (tableKey === 'owner') pkColumn = 'owner_id';

                const { error } = await supabase
                    .from(tableName)
                    .delete()
                    .eq(pkColumn, recordId);

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
    if (data['Remarks'] !== undefined || data['remarks'] !== undefined) {
        const raw = data['Remarks'] !== undefined ? data['Remarks'] : data['remarks'];
        mapped.remarks = (raw == null ? '' : String(raw)).slice(0, 30);
    }

    return mapped;
}
