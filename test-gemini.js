import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // There isn't a direct listModels in the client SDK like this usually, 
        // but we can try to get a model and see if it fails.
        // Actually, the error message in the previous run suggested many strings.

        const modelName = 'gemini-3-flash-preview';
        const model = genAI.getGenerativeModel({ model: modelName });
        console.log(`Model object created for ${modelName}`);

        // Try a dummy request
        const res = await model.generateContent("test");
        console.log('Test successful:', res.response.text());
    } catch (e) {
        console.error('Test failed:', e);
    }
}

listModels();
