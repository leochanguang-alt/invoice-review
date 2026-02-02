/**
 * 根据 currency_list（含 currency_code、country）在识别结果中自动补全货币或国家
 * - 有货币无国家：用 currency_list 中该货币对应的 country 填充
 * - 有国家无货币：用 currency_list 中该国对应的 currency_code 填充
 */

/**
 * @param {Object} processedData - 发票识别结果，至少含 currency、country（可空）
 * @param {Array<{ currency_code?: string, country?: string }>} currencyList - Supabase currency_list 行
 * @returns {void} 原地修改 processedData
 */
export function linkCurrencyCountry(processedData, currencyList) {
    if (!currencyList || currencyList.length === 0) return;

    const currency = (processedData.currency || '').toString().trim().toUpperCase();
    const country = (processedData.country || '').toString().trim();

    const hasCurrency = currency.length > 0;
    const hasCountry = country.length > 0;

    if (hasCurrency && !hasCountry) {
        const row = currencyList.find(
            (r) => (r.currency_code || '').toString().trim().toUpperCase() === currency
        );
        if (row && row.country) {
            processedData.country = (row.country || '').toString().trim();
        }
    } else if (hasCountry && !hasCurrency) {
        const row = currencyList.find(
            (r) => (r.country || '').toString().trim().toLowerCase() === country.toLowerCase()
        );
        if (row && row.currency_code) {
            processedData.currency = (row.currency_code || '').toString().trim().toUpperCase();
        }
    }
}

/**
 * 从 Supabase 读取 currency_list（currency_code, country）
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{ currency_code?: string, country?: string }>>}
 */
export async function getCurrencyList(supabase) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('currency_list')
            .select('currency_code, country');
        if (error) return [];
        return data || [];
    } catch {
        return [];
    }
}
