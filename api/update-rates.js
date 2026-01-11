/**
 * 汇率更新 API（改为写入 Supabase，不再写 Google Sheet）
 *
 * GET /api/update-rates            - 仅在每月1日运行（除非 ?force=true）
 * GET /api/update-rates?force=true - 强制运行
 *
 * 逻辑：
 * 1) 货币列表来源：Supabase 表 currency_list
 * 2) 写入目标：Supabase 表 currency_rates（唯一键 currency_code + rate_date）
 */

import { supabase } from './_supabase.js';

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
                message: '今天不是月初，无需更新汇率',
                today: formatDate(today),
                nextUpdate: formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 1))
            });
        }

        // 1) 读取货币列表（Supabase currency_list）
        const { data: currencyRows, error: listErr } = await supabase
            .from('currency_list')
            .select('currency_code');

        if (listErr) {
            return json(res, 500, { success: false, message: `读取货币列表失败: ${listErr.message}` });
        }

        const currencies = (currencyRows || [])
            .map(r => (r.currency_code || '').trim().toUpperCase())
            .filter(Boolean);

        if (currencies.length === 0) {
            return json(res, 200, { success: true, message: '货币列表为空' });
        }

        const firstDay = getFirstDayOfMonth();
        const dateStr = formatDate(firstDay);

        // 2) 获取当月已存在记录，避免重复
        const { data: existing, error: existErr } = await supabase
            .from('currency_rates')
            .select('currency_code, rate_date')
            .eq('rate_date', dateStr);

        if (existErr) {
            return json(res, 500, { success: false, message: `读取历史记录失败: ${existErr.message}` });
        }

        const existingSet = new Set((existing || []).map(r => `${r.currency_code}_${r.rate_date}`));

        const upserts = [];
        const results = [];

        for (const currency of currencies) {
            const key = `${currency}_${dateStr}`;
            if (existingSet.has(key)) {
                results.push({ currency, status: 'skipped', message: '已存在' });
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
                    results.push({ currency, status: 'failed', message: '获取失败' });
                }
            }

            // 轻量限速
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // 3) 写入 Supabase（upsert，唯一键 currency_code+rate_date）
        if (upserts.length > 0) {
            const { error: upsertErr } = await supabase
                .from('currency_rates')
                .upsert(upserts, { onConflict: 'currency_code,rate_date' });

            if (upsertErr) {
                return json(res, 500, { success: false, message: `写入失败: ${upsertErr.message}` });
            }
        }

        return json(res, 200, {
            success: true,
            message: `已更新 ${upserts.length} 条汇率记录`,
            date: dateStr,
            results
        });

    } catch (e) {
        console.error('汇率更新错误:', e);
        return json(res, 500, { success: false, message: e?.message || String(e) });
    }
}
