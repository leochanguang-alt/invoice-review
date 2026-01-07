import 'dotenv/config';
import handler from './api/submit.js';

async function testSubmit() {
    console.log('--- Starting Submit Verification ---');

    // Mock request and response
    const req = {
        method: 'POST',
        body: {
            records: [
                {
                    rowNumber: 3,
                    companyId: 'BUI Service',
                    projectCode: 'BUI-2512',
                    amount: '5.93',
                    currency: 'GBP',
                    fileId: '1rxU95CPTZBd7AJdoCK971j2R-9vTty10' // The Ivy In The Park
                }
            ]
        }
    };

    const res = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        end(data) {
            this.data = JSON.parse(data);
            console.log('Response Status:', this.statusCode);
            console.log('Response Data:', JSON.stringify(this.data, null, 2));
        }
    };

    try {
        await handler(req, res);

        if (res.data.success) {
            console.log('\nSUCCESS: Submit logic executed.');
            console.log('Check the "Main" sheet for row 3 updates and the project folder for the new file.');
        } else {
            console.error('\nFAILED:', res.data.message);
        }
    } catch (error) {
        console.error('\nEXECUTION ERROR:', error);
    }
}

testSubmit();
