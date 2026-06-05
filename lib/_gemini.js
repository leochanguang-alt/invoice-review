const DEFAULT_FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
];

function normalizeModelName(value) {
    return (value || "").toString().trim();
}

export function getGeminiModelCandidates() {
    const primary = normalizeModelName(process.env.GEMINI_MODEL);
    const extra = (process.env.GEMINI_FALLBACK_MODELS || "")
        .split(",")
        .map(normalizeModelName)
        .filter(Boolean);

    const merged = [primary, ...extra, ...DEFAULT_FALLBACK_MODELS]
        .filter(Boolean);

    // Keep order but remove duplicates.
    return Array.from(new Set(merged));
}

function isModelNotFoundError(err) {
    const msg = (err?.message || String(err || "")).toLowerCase();
    return (
        msg.includes("404") ||
        msg.includes("not found for api version") ||
        msg.includes("models/") && msg.includes("not found") ||
        msg.includes("is not supported for generatecontent")
    );
}

export async function generateContentWithFallback(genAI, payload, { logger = console } = {}) {
    const models = getGeminiModelCandidates();
    let lastErr = null;

    for (const modelName of models) {
        try {
            logger.log?.(`[GEMINI] Trying model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(payload);
            return { result, modelName };
        } catch (err) {
            lastErr = err;
            if (isModelNotFoundError(err)) {
                logger.warn?.(`[GEMINI] Model unavailable: ${modelName}. Trying next fallback.`);
                continue;
            }
            throw err;
        }
    }

    throw new Error(
        `All Gemini models failed: ${models.join(", ")}. Last error: ${lastErr?.message || String(lastErr)}`
    );
}
