import { extractPdfLines, allLines } from './pdf-text.js';
import { detectBank } from './detect.js';
import { parseBcmLines } from './bcm.js';
import { parseHsbcLines } from './hsbc.js';
import { parseRevolutLines } from './revolut.js';

/**
 * Parse a bank statement PDF buffer into a normalized preview object.
 * @param {Uint8Array|Buffer} pdfBytes
 * @param {{ bank?: string }} [options]
 */
export async function parseStatementPdf(pdfBytes, options = {}) {
    const { pages, fullText } = await extractPdfLines(pdfBytes);
    const lines = allLines(pages);
    const bank = options.bank || detectBank(fullText);

    if (!bank) {
        return {
            ok: false,
            error: 'Unsupported or unrecognized bank statement. Supported: BCM, HSBC, Revolut.',
            bank: null,
            fullTextPreview: fullText.slice(0, 500),
        };
    }

    let parsed;
    if (bank === 'BCM') parsed = parseBcmLines(lines);
    else if (bank === 'HSBC') parsed = parseHsbcLines(lines);
    else if (bank === 'REVOLUT') parsed = parseRevolutLines(lines);
    else {
        return { ok: false, error: `Unsupported bank: ${bank}`, bank };
    }

    return {
        ok: true,
        bank,
        ...parsed,
        tx_count: parsed.transactions.length,
    };
}

export { detectBank, extractPdfLines, parseBcmLines, parseHsbcLines, parseRevolutLines };
