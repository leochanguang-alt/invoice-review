/**
 * Detect which bank a statement PDF belongs to from extracted text.
 * @param {string} fullText
 * @returns {'BCM'|'HSBC'|'REVOLUT'|null}
 */
export function detectBank(fullText) {
    const text = String(fullText || '');

    if (
        (text.includes('交通银行') || text.includes('交通银⾏') || text.includes('bankcomm')) &&
        (text.includes('Statement Cycle') || text.includes('账单周期'))
    ) {
        return 'BCM';
    }

    if (
        /HSBC/i.test(text) &&
        (/Premier\s*Credit\s*Card/i.test(text) || /Your Transaction Details/i.test(text))
    ) {
        return 'HSBC';
    }

    if (
        /Revolut/i.test(text) &&
        (/IBAN/i.test(text) || /Account transactions from/i.test(text))
    ) {
        return 'REVOLUT';
    }

    return null;
}
