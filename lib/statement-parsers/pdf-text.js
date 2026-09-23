import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const Y_TOLERANCE = 2.5;

/**
 * Extract text items from a PDF buffer, grouped into reading-order lines.
 * @param {Uint8Array|Buffer} pdfBytes
 * @returns {Promise<{ pages: Array<{ pageNumber: number, lines: Array<{ y: number, text: string, items: Array<{ x: number, str: string }> }> }>, fullText: string }>}
 */
export async function extractPdfLines(pdfBytes) {
    // pdfjs rejects Node Buffer; always copy into a plain Uint8Array.
    const data = new Uint8Array(pdfBytes);
    const doc = await getDocument({ data, useSystemFonts: true, disableWorker: true }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = (content.items || [])
            .filter((item) => item && typeof item.str === 'string' && item.str.trim().length > 0)
            .map((item) => ({
                x: Number(item.transform?.[4] ?? 0),
                y: Number(item.transform?.[5] ?? 0),
                str: item.str,
            }));

        // Group into rows by approximate y, then sort left-to-right.
        const rows = [];
        for (const item of items) {
            let row = rows.find((r) => Math.abs(r.y - item.y) <= Y_TOLERANCE);
            if (!row) {
                row = { y: item.y, items: [] };
                rows.push(row);
            }
            row.items.push(item);
        }

        rows.sort((a, b) => b.y - a.y);
        const lines = rows.map((row) => {
            const sorted = row.items.slice().sort((a, b) => a.x - b.x);
            // Deduplicate overlapping identical glyphs (BCM email PDFs often duplicate text).
            const deduped = [];
            for (const part of sorted) {
                const prev = deduped[deduped.length - 1];
                if (prev && prev.str === part.str && Math.abs(prev.x - part.x) < 1.5) continue;
                deduped.push(part);
            }
            return {
                y: row.y,
                text: deduped.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim(),
                items: deduped,
            };
        }).filter((line) => line.text.length > 0);

        pages.push({ pageNumber, lines });
    }

    const fullText = pages
        .flatMap((p) => p.lines.map((l) => l.text))
        .join('\n');

    return { pages, fullText };
}

export function allLines(pages) {
    return pages.flatMap((p) => p.lines);
}
