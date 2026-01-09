import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { json } from "./_sheets.js";

// Initialize R2 client
// Note: These env vars must be set by the user
const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return json(res, 405, { success: false, message: "Method Not Allowed" });
    }

    try {
        const { fileName } = req.body;

        if (!fileName) {
            return json(res, 400, { success: false, message: "fileName is required" });
        }

        // 1. Download file content from R2
        const command = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileName,
        });

        const response = await r2.send(command);
        const fileArrayBuffer = await response.Body.transformToByteArray();

        // 2. Analyze with Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
            "请分析此文件并提取核心数据。请以JSON格式返回，包含：invoice_date, vendor, amount, currency, category, project_code。",
            {
                inlineData: {
                    data: Buffer.from(fileArrayBuffer).toString("base64"),
                    mimeType: "application/pdf"
                }
            }
        ]);

        const analysisText = result.response.text();

        return json(res, 200, {
            success: true,
            analysis: analysisText
        });
    } catch (error) {
        console.error("Analysis Error:", error);
        return json(res, 500, {
            success: false,
            message: error.message || String(error)
        });
    }
}
