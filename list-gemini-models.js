import 'dotenv/config';

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    console.log(`Listing models from: https://generativelanguage.googleapis.com/v1beta/models?key=...`);

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error('API Error:', JSON.stringify(data.error, null, 2));
        } else {
            console.log('Available Models Summary:');
            const names = data.models?.map(m => m.name);
            console.log(JSON.stringify(names, null, 2));
        }
    } catch (e) {
        console.error('List failed:', e);
    }
}

listModels();
