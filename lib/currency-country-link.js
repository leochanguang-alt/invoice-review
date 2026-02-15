/**
 * Auto-complete currency or country in recognition results based on currency_list (containing currency_code, country)
 * - Has currency, no country: fill with the country corresponding to that currency in currency_list
 * - Has country, no currency: fill with the currency_code corresponding to that country in currency_list
 */

/**
 * @param {Object} processedData - Invoice recognition result, containing at least currency, country (can be empty)
 * @param {Array<{ currency_code?: string, country?: string }>} currencyList - Supabase currency_list rows
 * @returns {void} Modifies processedData in place
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
 * Read currency_list (currency_code, country) from Supabase
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
