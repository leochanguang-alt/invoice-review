import { supabase } from './api/_supabase.js';

// Mock data to simulate Gemini response
const mockResponses = [
    {
        name: "Case 1: Standard Capitals",
        text: '{"invoice_number": "INV-001", "date": "2024-01-01", "vendor_name": "Test Vendor", "City": "London", "Country": "UK", "total_amount": 100.50, "currency": "GBP", "category": "Meal"}'
    },
    {
        name: "Case 2: Lowercase and symbols",
        text: '```json\n{"invoice_no": "INV-002", "invoice_date": "2024-01-02", "vendor": "Another Vendor", "city": "Paris", "country": "France", "amount": "€ 2,500.00", "currency": "EUR", "category": "Hotel"}\n```'
    }
];

function testExtraction(responseText) {
    console.log('\nTesting response:', responseText.substring(0, 50) + '...');

    // Logic copied from auto-process-invoices.js for verification
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        jsonStr = jsonMatch[0];
    }

    const invoiceData = JSON.parse(jsonStr);

    const getVal = (obj, keys) => {
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return null;
    };

    const cleanAmount = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const cleaned = val.toString().replace(/[^\d.-]/g, '');
        return parseFloat(cleaned) || 0;
    };

    const cleanString = (val) => (val || '').toString().trim();

    const result = {
        invoice_date: cleanString(getVal(invoiceData, ['date', 'invoice_date'])),
        vendor: cleanString(getVal(invoiceData, ['vendor_name', 'vendor'])),
        amount: cleanAmount(getVal(invoiceData, ['total_amount', 'amount'])),
        currency: cleanString(getVal(invoiceData, ['currency'])),
        invoice_number: cleanString(getVal(invoiceData, ['invoice_number', 'invoice_no'])),
        location_city: cleanString(getVal(invoiceData, ['city', 'City', 'location_city'])),
        country: cleanString(getVal(invoiceData, ['country', 'Country'])),
        category: cleanString(getVal(invoiceData, ['category']))
    };

    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
}

console.log('--- Starting Extraction Tests ---');
mockResponses.forEach(m => {
    console.log(`\nTest: ${m.name}`);
    testExtraction(m.text);
});

console.log('\n--- Tests Finished ---');
