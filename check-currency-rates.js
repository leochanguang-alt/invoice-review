/**
 * Check Supabase currency_rates table: whether exchange rate records exist for specified date
 * Usage: node check-currency-rates.js [date, default 2025-02-01]
 */
import 'dotenv/config';
import { supabase } from './lib/_supabase.js';

async function main() {
    const dateArg = process.argv[2] || '2025-02-01';
    if (!supabase) {
        console.error('Supabase not initialized.');
        process.exit(1);
    }

    console.log('=== currency_rates check ===\n');
    console.log('Target date:', dateArg);

    // 1) All exchange rate records for this date
    const { data: rows, error } = await supabase
        .from('currency_rates')
        .select('currency_code, rate_date, rate_to_hkd')
        .eq('rate_date', dateArg)
        .order('currency_code');

    if (error) {
        console.error('Query failed:', error.message);
        process.exit(1);
    }

    if (!rows || rows.length === 0) {
        console.log(`\nResult: No exchange rate records found for ${dateArg}.`);
    } else {
        console.log(`\nResult: Found ${rows.length} records for ${dateArg}:\n`);
        rows.forEach(r => console.log(`  ${r.currency_code}\t${r.rate_to_hkd}`));
    }

    // 2) All existing rate_dates (to confirm which months have been updated)
    const { data: dates, error: datesErr } = await supabase
        .from('currency_rates')
        .select('rate_date')
        .order('rate_date', { ascending: false });

    if (!datesErr && dates && dates.length > 0) {
        const unique = [...new Set(dates.map(d => d.rate_date))];
        console.log('\nExisting rate dates (descending):', unique.slice(0, 12).join(', '));
        if (unique.length > 12) console.log('  ... total', unique.length, 'unique dates');
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
