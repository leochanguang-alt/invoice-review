import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateContentWithFallback } from './lib/_gemini.js';

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const { result: res, modelName } = await generateContentWithFallback(
            genAI,
            "test"
        );
        console.log(`Model used: ${modelName}`);
        console.log('Test successful:', res.response.text());
    } catch (e) {
        console.error('Test failed:', e);
    }
}

listModels();
