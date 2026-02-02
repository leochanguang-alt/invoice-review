/**
 * 补写指定日期的汇率到 Supabase currency_rates
 * 用法: node backfill-currency-rates.js [日期，默认 2026-02-01]
 */
import 'dotenv/config';
import { supabase } from './api/_supabase.js';

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

    console.log('=== 补写汇率 ===');
    console.log('目标日期:', dateStr, '\n');

    const { data: currencyRows, error: listErr } = await supabase
        .from('currency_list')
        .select('currency_code');

    if (listErr) {
        console.error('读取货币列表失败:', listErr.message);
        process.exit(1);
    }

    const currencies = (currencyRows || [])
        .map(r => (r.currency_code || '').trim().toUpperCase())
        .filter(Boolean);

    if (currencies.length === 0) {
        console.log('货币列表为空');
        process.exit(0);
    }

    const { data: existing, error: existErr } = await supabase
        .from('currency_rates')
        .select('currency_code, rate_date')
        .eq('rate_date', dateStr);

    if (existErr) {
        console.error('读取已存在记录失败:', existErr.message);
        process.exit(1);
    }

    const existingSet = new Set((existing || []).map(r => `${r.currency_code}_${r.rate_date}`));
    const upserts = [];

    for (const currency of currencies) {
        if (existingSet.has(`${currency}_${dateStr}`)) {
            console.log(`  ${currency}: 已存在，跳过`);
            continue;
        }
        if (currency === 'HKD') {
            upserts.push({ currency_code: currency, rate_date: dateStr, rate_to_hkd: 1 });
            console.log(`  ${currency}: 1 (本币)`);
        } else {
            const rate = await getExchangeRate(currency);
            if (rate !== null) {
                upserts.push({ currency_code: currency, rate_date: dateStr, rate_to_hkd: rate });
                console.log(`  ${currency}: ${rate}`);
            } else {
                console.log(`  ${currency}: 获取失败`);
            }
        }
        await new Promise(r => setTimeout(r, 200));
    }

    if (upserts.length === 0) {
        console.log('\n无需写入（该日期已存在全部记录）。');
        process.exit(0);
    }

    const { error: upsertErr } = await supabase
        .from('currency_rates')
        .upsert(upserts, { onConflict: 'currency_code,rate_date' });

    if (upsertErr) {
        console.error('\n写入失败:', upsertErr.message);
        process.exit(1);
    }

    console.log(`\n已写入 ${dateStr} 共 ${upserts.length} 条汇率记录。`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
