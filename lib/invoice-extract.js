// Shared Gemini invoice extraction, used by both the scheduled GitHub Actions
// run and the on-demand sync triggered from the UI.
import { generateContentWithFallback } from "./_gemini.js";
import { linkCurrencyCountry } from "./currency-country-link.js";

export const EXTRACTION_PROMPT = `Please analyze this invoice image. Extract the following information and return it in strict JSON format, without any Markdown formatting or explanatory text:
invoice_number (invoice number)
date (date, format YYYY-MM-DD)
vendor_name (vendor name)
City: (city where expense occurred)
Country: (country where expense occurred)
total_amount (total amount, numeric format)
currency (currency unit, choose one: GBP/HKD/USD/EUR/SEK/DKK/CHF/CNY/CAD/AED)
category (expense category, choose one: Hotel/Flight/Train/Taxi/Entertainment/office expense/Communication/IT expense/Meal)`;

const MIME_TYPES = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
};

export const SUPPORTED_EXTENSIONS = Object.keys(MIME_TYPES);

export function mimeTypeForFile(filename) {
    const ext = String(filename || "").toLowerCase().split(".").pop();
    return MIME_TYPES[ext] || "application/octet-stream";
}

export function isSupportedInvoiceFile(filename) {
    const ext = String(filename || "").toLowerCase().split(".").pop();
    return Object.prototype.hasOwnProperty.call(MIME_TYPES, ext);
}

export function cleanAmount(value) {
    if (typeof value === "number") return value;
    if (!value) return 0;
    const cleaned = value.toString().replace(/[^\d.-]/g, "");
    return parseFloat(cleaned) || 0;
}

export function cleanString(value) {
    return (value == null ? "" : String(value)).trim();
}

function firstPresent(obj, keys) {
    for (const key of keys) {
        if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
    }
    return null;
}

export function parseExtractionResponse(responseText) {
    const match = String(responseText || "").match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : responseText);
}

// Postgres rejects "" for date columns, so an unreadable date must become null.
export function buildInvoiceFields(raw, { currencyList = [] } = {}) {
    const fields = {
        invoice_date: cleanString(firstPresent(raw, ["date", "invoice_date"])) || null,
        vendor: cleanString(firstPresent(raw, ["vendor_name", "vendor"])),
        amount: cleanAmount(firstPresent(raw, ["total_amount", "amount"])),
        currency: cleanString(firstPresent(raw, ["currency"])),
        invoice_number: cleanString(firstPresent(raw, ["invoice_number", "invoice_no"])),
        location_city: cleanString(firstPresent(raw, ["city", "City", "location_city"])),
        country: cleanString(firstPresent(raw, ["country", "Country"])),
        category: cleanString(firstPresent(raw, ["category"])),
    };

    linkCurrencyCountry(fields, currencyList);
    return fields;
}

export async function extractInvoiceFields(genAI, { bytes, mimeType, currencyList = [], logger = console }) {
    const { result, modelName } = await generateContentWithFallback(
        genAI,
        [
            { inlineData: { data: Buffer.from(bytes).toString("base64"), mimeType } },
            EXTRACTION_PROMPT,
        ],
        { logger },
    );

    const raw = parseExtractionResponse(result.response.text());
    return { fields: buildInvoiceFields(raw, { currencyList }), modelName };
}
