// Using native fetch (Node 18+)

async function testAnalysis() {
    const fileName = 'test-invoice.pdf'; // Ensure this file exists in your R2 bucket

    try {
        const response = await fetch('http://localhost:3001/api/analyze-invoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fileName }),
        });

        const data = await response.json();
        console.log('Result:', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Test Failed:', error);
    }
}

testAnalysis();
