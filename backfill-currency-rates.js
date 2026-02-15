/**
 * Backfill exchange rates for specified date to Supabase currency_rates
 * Usage: node backfill-currency-rates.js [date, default 2026-02-01]
 */
import 'dotenv/config';
import { supabase } from './lib/_supabase.js';

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

async function main() {
    const dateStr = process.argv[2] || '2026-02-01';
    if (!supabase) {
        console.error('Supabase not initialized.');
        process.exit(1);
    }

    console.log('=== Backfill Exchange Rates ===');
    console.log('Target date:', dateStr, '\n');

    const { data: currencyRows, error: listErr } = await supabase
        .from('currency_list')
        .select('currency_code');

    if (listErr) {
        console.error('Failed to read currency list:', listErr.message);
        process.exit(1);
    }

    const currencies = (currencyRows || [])
        .map(r => (r.currency_code || '').trim().toUpperCase())
        .filter(Boolean);

    if (currencies.length === 0) {
        console.log('Currency list is empty');
        process.exit(0);
    }

    const { data: existing, error: existErr } = await supabase
        .from('currency_rates')
        .select('currency_code, rate_date')
        .eq('rate_date', dateStr);

    if (existErr) {
        console.error('Failed to read existing records:', existErr.message);
        process.exit(1);
    }

    const existingSet = new Set((existing || []).map(r => `${r.currency_code}_${r.rate_date}`));
    const upserts = [];

    for (const currency of currencies) {
        if (existingSet.has(`${currency}_${dateStr}`)) {
            console.log(`  ${currency}: Already exists, skipping`);
            continue;
        }
        if (currency === 'HKD') {
            upserts.push({ currency_code: currency, rate_date: dateStr, rate_to_hkd: 1 });
            console.log(`  ${currency}: 1 (base currency)`);
        } else {
            const rate = await getExchangeRate(currency);
            if (rate !== null) {
                upserts.push({ currency_code: currency, rate_date: dateStr, rate_to_hkd: rate });
                console.log(`  ${currency}: ${rate}`);
            } else {
                console.log(`  ${currency}: Failed to fetch`);
            }
        }
        await new Promise(r => setTimeout(r, 200));
    }

    if (upserts.length === 0) {
        console.log('\nNo need to write (all records already exist for this date).');
        process.exit(0);
    }

    const { error: upsertErr } = await supabase
        .from('currency_rates')
        .upsert(upserts, { onConflict: 'currency_code,rate_date' });

    if (upsertErr) {
        console.error('\nWrite failed:', upsertErr.message);
        process.exit(1);
    }

    console.log(`\nWritten ${upserts.length} exchange rate records for ${dateStr}.`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
