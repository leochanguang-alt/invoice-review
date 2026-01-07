import 'dotenv/config';
import { getSheetsClient, SHEET_ID, buildHeaderIndex, norm } from './api/_sheets.js';
import { supabase } from './api/_supabase.js';
import fs from 'fs';

const logFile = 'migration.log';
function log(msg) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

function formatDate(val) {
    if (!val) return null;
    let s = val.toString().trim();

    if (/^\d{4}$/.test(s)) {
        return `${s}-01-01`;
    }

    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        const year = dmy[3];
        return `${year}-${month}-${day}`;
    }

    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
    }
    return s;
}

async function migrate() {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    log('--- Starting Final Migration from Google Sheets to Supabase ---');
    if (!supabase) {
        log('Error: Supabase client not initialized.');
        return;
    }
    const sheets = getSheetsClient();

    let validCompanyIds = new Set();

    const mappings = [
        {
            sheet: 'Company_info',
            table: 'companies',
            columns: {
                'Company_ID': 'company_id',
                'Company Name': 'company_name',
                'Country': 'country',
                'Company Contact': 'company_contact'
            },
            uniqueKey: 'company_id'
        },
        {
            sheet: 'Invoice_Owner',
            table: 'owners',
            columns: {
                'Owner ID': 'owner_id',
                'Owner': 'owner_name',
                'First Name': 'first_name',
                'Last Name': 'last_name',
                'Company': 'company',
                'Mobile': 'mobile',
                'Bank Account': 'bank_account'
            },
            uniqueKey: 'owner_id'
        },
        {
            sheet: 'Projects',
            table: 'projects',
            columns: {
                'Project_ID': 'project_id',
                'Project Code': 'project_code',
                'Project Name': 'project_name',
                'Company_ID': 'company_id',
                'Create Date': 'create_date',
                'End Date': 'end_date',
                'Project Owner': 'project_owner',
                'Drive_Folder_Link': 'drive_folder_link'
            },
            uniqueKey: 'project_id'
        },
        {
            sheet: 'Currency_List',
            table: 'currency_list',
            columns: {
                'Currency_Code': 'currency_code'
            },
            uniqueKey: 'currency_code'
        },
        {
            sheet: 'C_Rate',
            table: 'currency_rates',
            columns: {
                'Currency Code': 'currency_code',
                'Date': 'rate_date',
                'Rate to HKD': 'rate_to_hkd'
            }
        },
        {
            sheet: 'List',
            table: 'dropdown_lists',
            columns: {
                'Company_Name': 'company_name',
                'Project_Name': 'project_name',
                'Currency': 'currency',
                'Curreny Ratio': 'currency_ratio'
            }
        },
        {
            sheet: 'Main',
            table: 'invoices',
            columns: {
                'File_ID': 'file_id',
                'Invoice_data': 'invoice_date',
                'Vendor': 'vendor',
                'amount': 'amount',
                'currency': 'currency',
                'invoice_number': 'invoice_number',
                'Location(City)': 'location_city',
                'Country': 'country',
                'Category': 'category',
                'file_link': 'file_link',
                'Status': 'status',
                'Charge to Company': 'charge_to_company',
                'Charge to Project': 'charge_to_project',
                'Owner': 'owner_name',
                'Invoice_ID': 'generated_invoice_id',
                'Amount (HKD)': 'amount_hkd',
                'Achieved_File_ID': 'archived_file_id',
                'Achieved_File_link': 'archived_file_link'
            },
            uniqueKey: 'file_id'
        },
        {
            sheet: 'Statement',
            table: 'statements',
            columns: {
                'ID': 'id',
                'Invoice_data': 'invoice_date',
                'Vendor': 'vendor',
                'amount': 'amount',
                'currency': 'currency',
                'invoice_number': 'invoice_number',
                'Items': 'items',
                'Location(City)': 'location_city',
                'Country': 'country',
                'Category': 'category',
                'file_link': 'file_link',
                'Status': 'status',
                'Charge to Company': 'charge_to_company',
                'Charge to Project': 'charge_to_project',
                'Owner': 'owner_name'
            },
            uniqueKey: 'id'
        }
    ];

    for (const mapping of mappings) {
        log(`\nMigrating sheet: "${mapping.sheet}" to table: "${mapping.table}"`);

        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `${mapping.sheet}!A:Z`
            });

            const rows = res.data.values || [];
            if (rows.length < 2) {
                log('No data to migrate.');
                continue;
            }

            const headers = rows[0].map(norm);
            const headerMap = buildHeaderIndex(headers);
            const dataToInsert = [];
            const seenKeys = new Set();
            const missingCompanies = new Set();

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const item = {};
                let hasData = false;

                for (const [sheetCol, dbCol] of Object.entries(mapping.columns)) {
                    const idx = headerMap.get(norm(sheetCol));
                    if (idx !== undefined) {
                        let val = norm(row[idx]);
                        if (val !== "") {
                            if (dbCol.includes('date')) {
                                val = formatDate(val);
                            }
                            // Number conversion (exclusive of date fields)
                            if ((dbCol.includes('amount') || dbCol.includes('rate') || dbCol === 'currency_ratio') && !dbCol.includes('date')) {
                                val = parseFloat(val.toString().replace(/,/g, ''));
                                if (isNaN(val)) val = null;
                            }
                            item[dbCol] = val;
                            hasData = true;
                        }
                    }
                }

                if (hasData) {
                    // Duplicate check based on uniqueKey
                    if (mapping.uniqueKey && item[mapping.uniqueKey]) {
                        if (seenKeys.has(item[mapping.uniqueKey])) {
                            log(`Duplicate key found in ${mapping.sheet} at row ${i + 1}: ${item[mapping.uniqueKey]}. Skipping duplication.`);
                            continue;
                        }
                        seenKeys.add(item[mapping.uniqueKey]);
                    }

                    if (mapping.table === 'companies') {
                        validCompanyIds.add(item.company_id);
                    }

                    // Special handling for Projects to avoid FK violations
                    if (mapping.table === 'projects' && item.company_id) {
                        if (!validCompanyIds.has(item.company_id)) {
                            missingCompanies.add(item.company_id);
                        }
                    }

                    dataToInsert.push(item);
                }
            }

            // Auto-reconcile missing companies
            if (missingCompanies.size > 0) {
                log(`Adding ${missingCompanies.size} missing companies to avoid FK violations: ${Array.from(missingCompanies).join(', ')}`);
                const placeholders = Array.from(missingCompanies).map(cid => ({
                    company_id: cid,
                    company_name: `Automated Placeholder for ${cid}`
                }));
                await supabase.from('companies').upsert(placeholders);
                placeholders.forEach(p => validCompanyIds.add(p.company_id));
            }

            if (dataToInsert.length > 0) {
                log(`Inserting ${dataToInsert.length} records...`);
                const { error } = await supabase.from(mapping.table).upsert(dataToInsert, {
                    onConflict: mapping.uniqueKey || undefined
                });

                if (error) {
                    log(`Error inserting table ${mapping.table}: ${error.message}`);
                    log(`Failing Item Sample: ${JSON.stringify(dataToInsert[0])}`);
                } else {
                    log(`Successfully migrated "${mapping.sheet}".`);
                }
            } else {
                log('No valid data found after mapping.');
            }

        } catch (err) {
            log(`Unexpected error migrating "${mapping.sheet}": ${err.message}`);
        }
    }

    log('\n--- Migration Finished ---');
}

migrate();
