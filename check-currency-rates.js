/**
 * 检查 Supabase currency_rates 表：指定日期是否有汇率记录
 * 用法: node check-currency-rates.js [日期，默认 2025-02-01]
 */
import 'dotenv/config';
import { supabase } from './api/_supabase.js';

async function main() {
    const dateArg = process.argv[2] || '2025-02-01';
    if (!supabase) {
        console.error('Supabase not initialized.');
        process.exit(1);
    }

    console.log('=== currency_rates 检查 ===\n');
    console.log('目标日期:', dateArg);

    // 1) 该日期的所有汇率记录
    const { data: rows, error } = await supabase
        .from('currency_rates')
        .select('currency_code, rate_date, rate_to_hkd')
        .eq('rate_date', dateArg)
        .order('currency_code');

    if (error) {
        console.error('查询失败:', error.message);
        process.exit(1);
    }

    if (!rows || rows.length === 0) {
        console.log(`\n结果: 没有找到 ${dateArg} 的汇率记录。`);
    } else {
        console.log(`\n结果: 找到 ${dateArg} 共 ${rows.length} 条记录:\n`);
        rows.forEach(r => console.log(`  ${r.currency_code}\t${r.rate_to_hkd}`));
    }

    // 2) 所有已存在的 rate_date（便于确认哪些月份已更新）
    const { data: dates, error: datesErr } = await supabase
        .from('currency_rates')
        .select('rate_date')
        .order('rate_date', { ascending: false });

    if (!datesErr && dates && dates.length > 0) {
        const unique = [...new Set(dates.map(d => d.rate_date))];
        console.log('\n已存在汇率的日期（按时间倒序）:', unique.slice(0, 12).join(', '));
        if (unique.length > 12) console.log('  ... 共', unique.length, '个不同日期');
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
