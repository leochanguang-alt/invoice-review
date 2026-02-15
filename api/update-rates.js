/**
 * Exchange Rate Update API (writes to Supabase, no longer to Google Sheet)
 *
 * GET /api/update-rates            - Only runs on the 1st day of the month (unless ?force=true)
 * GET /api/update-rates?force=true - Force run
 *
 * Logic:
 * 1) Currency list source: Supabase table currency_list
 * 2) Write target: Supabase table currency_rates (unique key: currency_code + rate_date)
 */

import { supabase } from '../lib/_supabase.js';

async function getExchangeRate(fromCurrency, toCurrency = 'HKD') {
    try {
        const url = `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data.rates?.[toCurrency] ?? null;
    } catch {
        return null;
    }
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getFirstDayOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

function json(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
    try {
        if (!supabase) {
            return json(res, 500, { success: false, message: 'Supabase client not initialized' });
        }

        const today = new Date();
        const isFirstDay = today.getDate() === 1;
        const forceUpdate = req.query.force === 'true';

        if (!isFirstDay && !forceUpdate) {
            return json(res, 200, {
                success: true,
                message: 'Not the first day of the month, no rate update needed',
                today: formatDate(today),
                nextUpdate: formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 1))
            });
        }

        // 1) Read currency list (Supabase currency_list)
        const { data: currencyRows, error: listErr } = await supabase
            .from('currency_list')
            .select('currency_code');

        if (listErr) {
            return json(res, 500, { success: false, message: `Failed to read currency list: ${listErr.message}` });
        }

        const currencies = (currencyRows || [])
            .map(r => (r.currency_code || '').trim().toUpperCase())
            .filter(Boolean);

        if (currencies.length === 0) {
            return json(res, 200, { success: true, message: 'Currency list is empty' });
        }

        const firstDay = getFirstDayOfMonth();
        const dateStr = formatDate(firstDay);

        // 2) Get existing records for the month to avoid duplicates
        const { data: existing, error: existErr } = await supabase
            .from('currency_rates')
            .select('currency_code, rate_date')
            .eq('rate_date', dateStr);

        if (existErr) {
            return json(res, 500, { success: false, message: `Failed to read history records: ${existErr.message}` });
        }

        const existingSet = new Set((existing || []).map(r => `${r.currency_code}_${r.rate_date}`));

        const upserts = [];
        const results = [];

        for (const currency of currencies) {
            const key = `${currency}_${dateStr}`;
            if (existingSet.has(key)) {
                results.push({ currency, status: 'skipped', message: 'Already exists' });
                continue;
            }

            if (currency === 'HKD') {
                upserts.push({ currency_code: currency, rate_date: dateStr, rate_to_hkd: 1 });
                results.push({ currency, rate: 1, status: 'success' });
            } else {
                const rate = await getExchangeRate(currency);
                if (rate !== null) {
                    upserts.push({ currency_code: currency, rate_date: dateStr, rate_to_hkd: rate });
                    results.push({ currency, rate, status: 'success' });
                } else {
                    results.push({ currency, status: 'failed', message: 'Fetch failed' });
                }
            }

            // Light rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // 3) Write to Supabase (upsert, unique key: currency_code+rate_date)
        if (upserts.length > 0) {
            const { error: upsertErr } = await supabase
                .from('currency_rates')
                .upsert(upserts, { onConflict: 'currency_code,rate_date' });

            if (upsertErr) {
                return json(res, 500, { success: false, message: `Write failed: ${upsertErr.message}` });
            }
        }

        return json(res, 200, {
            success: true,
            message: `Updated ${upserts.length} exchange rate records`,
            date: dateStr,
            results
        });

    } catch (e) {
        console.error('Exchange rate update error:', e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
